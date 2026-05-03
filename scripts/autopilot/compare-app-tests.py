#!/usr/bin/env python3
"""
compare-app-tests.py — diff a current app-tests run against a committed baseline.

Writes a markdown report to --output and (optionally) appends it to
$GITHUB_STEP_SUMMARY. Exit code is 0 on regressions too — the `app-tests`
job is advisory in Phase 2. A future phase can wrap this script in a gate.

Inputs:
  --baseline        tests/sentinel/baseline.json (schema_version 1)
  --pytest-xml      junitxml produced by the pytest run
  --playwright-log  list-reporter stdout captured into run.log
  --output          path for the markdown report (always written)
  --step-summary    optional — appends the same report to this path
  --regressions-out optional — writes "true" or "false" so the workflow can
                    branch without grepping the markdown

Exit codes:
  0  report produced (regressions may still be present — advisory)
  2  baseline or input missing (workflow logs the reason and skips)
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path


# --- Parsing ----------------------------------------------------------------


@dataclass
class PytestResults:
    passed: set[str] = field(default_factory=set)
    failed: set[str] = field(default_factory=set)
    skipped: set[str] = field(default_factory=set)

    @property
    def total(self) -> int:
        return len(self.passed) + len(self.failed) + len(self.skipped)


@dataclass
class PlaywrightResults:
    passed: set[str] = field(default_factory=set)  # first-try passes
    flaky: set[str] = field(default_factory=set)  # passed on retry
    failed: set[str] = field(default_factory=set)  # failed all retries

    @property
    def total(self) -> int:
        return len(self.passed) + len(self.flaky) + len(self.failed)


def parse_pytest_xml(path: Path) -> PytestResults:
    results = PytestResults()
    tree = ET.parse(path)
    for case in tree.iter("testcase"):
        node_id = f"{case.attrib['classname']}::{case.attrib['name']}"
        if case.find("skipped") is not None:
            results.skipped.add(node_id)
        elif case.find("failure") is not None or case.find("error") is not None:
            results.failed.add(node_id)
        else:
            results.passed.add(node_id)
    return results


# Playwright list-reporter lines look like:
#   ✓   1 [setup] › tests/.../auth.setup.ts:15:5 › authenticate test user (2.2s)
#   ✓  39 [local] › tests/.../crud.spec.ts:76:7 › Settings CRUD (...) › edit (retry #1) (3.4s)
#   ✘  12 [local] › tests/.../something.spec.ts:10:7 › ... (2.1s)
# End-of-run block lists flaky and failed explicitly:
#   1 failed
#     [local] › tests/.../register-form.spec.ts:10:7 › ...
#   2 flaky
#     [local] › tests/.../crud.spec.ts:76:7 › ...
#     [local] › tests/.../crud.spec.ts:95:7 › ...
#
# We trust the explicit "failed"/"flaky" blocks for those sets, and treat every
# ✓ line not in those as a clean first-try pass.

_PW_TICK_RE = re.compile(
    r"^\s*[✓✔]\s+\d+\s+(\[[a-z]+\]\s+›\s+.+?)(?:\s+\(retry #\d+\))?(?:\s+\(\d+(?:\.\d+)?m?s\))?\s*$",
    re.MULTILINE,
)
_PW_FAILED_BLOCK = re.compile(r"^\s*\d+ failed\n((?:\s{4,}\[[a-z]+\].+\n)+)", re.MULTILINE)
_PW_FLAKY_BLOCK = re.compile(r"^\s*\d+ flaky\n((?:\s{4,}\[[a-z]+\].+\n)+)", re.MULTILINE)


def _canonical(line: str) -> str:
    # Strip duration suffix and retry marker so a "(retry #1)" pass matches the
    # baseline entry (which has neither).
    line = line.strip()
    line = re.sub(r"\s+\(retry #\d+\)$", "", line)
    line = re.sub(r"\s+\(\d+(?:\.\d+)?m?s\)$", "", line)
    return line


def _extract_block(pattern: re.Pattern[str], log: str) -> set[str]:
    m = pattern.search(log)
    if not m:
        return set()
    return {_canonical(l) for l in m.group(1).strip().splitlines()}


def parse_playwright_log(path: Path) -> PlaywrightResults:
    log = Path(path).read_text()
    ticks = {_canonical(l) for l in _PW_TICK_RE.findall(log)}
    failed = _extract_block(_PW_FAILED_BLOCK, log)
    flaky = _extract_block(_PW_FLAKY_BLOCK, log)
    # A ✓ line for a flaky test *is* its successful retry; exclude it from
    # clean passes to avoid double-counting.
    clean_passes = ticks - flaky - failed
    # Drop setup-project entries — they're a prerequisite, not a test signal.
    clean_passes = {t for t in clean_passes if not t.startswith("[setup] ")}
    return PlaywrightResults(passed=clean_passes, flaky=flaky, failed=failed)


# --- Comparison -------------------------------------------------------------


@dataclass
class SuiteDiff:
    name: str
    baseline_pass: set[str]
    baseline_known_failing: set[str]
    baseline_known_flaky: set[str]
    current_pass: set[str]
    current_fail: set[str]
    current_flaky: set[str] = field(default_factory=set)

    @property
    def regressions(self) -> list[str]:
        # Previously green, currently failing.
        return sorted(self.baseline_pass & self.current_fail)

    @property
    def new_flakes(self) -> list[str]:
        # Previously green, currently flaky (passed on retry). Not a hard
        # regression, but the test has become unreliable since baseline.
        return sorted(self.baseline_pass & self.current_flaky)

    @property
    def improvements(self) -> list[str]:
        # Previously known-failing, currently green.
        return sorted(self.baseline_known_failing & self.current_pass)

    @property
    def no_longer_flaky(self) -> list[str]:
        # Previously known-flaky, currently green on first try.
        return sorted(self.baseline_known_flaky & self.current_pass)

    @property
    def new_failures(self) -> list[str]:
        # Currently failing but not in any baseline list — new test or
        # something that existed but was previously skipped. Informational.
        known = (
            self.baseline_pass
            | self.baseline_known_failing
            | self.baseline_known_flaky
        )
        return sorted(self.current_fail - known)


# --- Report -----------------------------------------------------------------


def _bullet_list(items: list[str], limit: int = 20) -> str:
    if not items:
        return "_(none)_"
    bullets = [f"- `{t}`" for t in items[:limit]]
    if len(items) > limit:
        bullets.append(f"- _…and {len(items) - limit} more_")
    return "\n".join(bullets)


def _delta(current: int, baseline: int) -> str:
    diff = current - baseline
    if diff == 0:
        return "="
    return f"{diff:+d}"


def render_report(
    baseline_meta: dict,
    pytest_diff: SuiteDiff,
    playwright_diff: SuiteDiff,
    baseline_label: str = "baseline",
) -> tuple[str, bool]:
    """Return (markdown, has_regressions)."""
    has_regressions = bool(pytest_diff.regressions or playwright_diff.regressions)
    new_flakes = pytest_diff.new_flakes + playwright_diff.new_flakes
    improvements = pytest_diff.improvements + playwright_diff.improvements
    new_failures = pytest_diff.new_failures + playwright_diff.new_failures

    baseline_url = baseline_meta.get("generated_from_workflow_url", "")
    baseline_sha = (baseline_meta.get("git_sha") or "")[:7]

    lines: list[str] = ["## App Tests vs Baseline", ""]
    lines.append(f"**Compared against:** {baseline_label}")
    if baseline_url and baseline_sha:
        lines.append(f"**Source:** [{baseline_sha}]({baseline_url})")
    lines.append("")

    # Counts table.
    pt_cur_pass = len(pytest_diff.current_pass)
    pt_cur_fail = len(pytest_diff.current_fail)
    pt_bl_pass = len(pytest_diff.baseline_pass)
    pt_bl_fail = len(pytest_diff.baseline_known_failing)
    pw_cur_pass = len(playwright_diff.current_pass)
    pw_cur_flk = len(playwright_diff.current_flaky)
    pw_cur_fail = len(playwright_diff.current_fail)
    pw_bl_pass = len(playwright_diff.baseline_pass)
    pw_bl_flk = len(playwright_diff.baseline_known_flaky)
    pw_bl_fail = len(playwright_diff.baseline_known_failing)
    lines += [
        "| Suite | Metric | Current | Baseline | Δ |",
        "|---|---|---:|---:|---:|",
        f"| pytest     | passed        | {pt_cur_pass} | {pt_bl_pass} | {_delta(pt_cur_pass, pt_bl_pass)} |",
        f"| pytest     | failed        | {pt_cur_fail} | {pt_bl_fail} | {_delta(pt_cur_fail, pt_bl_fail)} |",
        f"| playwright | passed (1st)  | {pw_cur_pass} | {pw_bl_pass} | {_delta(pw_cur_pass, pw_bl_pass)} |",
        f"| playwright | flaky         | {pw_cur_flk}  | {pw_bl_flk}  | {_delta(pw_cur_flk, pw_bl_flk)} |",
        f"| playwright | failed        | {pw_cur_fail} | {pw_bl_fail} | {_delta(pw_cur_fail, pw_bl_fail)} |",
        "",
    ]

    if has_regressions:
        lines.append(f"### ⚠️ Regressions ({len(pytest_diff.regressions) + len(playwright_diff.regressions)})")
        lines.append("")
        lines.append("Tests that passed at baseline and are failing now.")
        lines.append("")
        if pytest_diff.regressions:
            lines.append("**pytest:**")
            lines.append(_bullet_list(pytest_diff.regressions))
            lines.append("")
        if playwright_diff.regressions:
            lines.append("**playwright:**")
            lines.append(_bullet_list(playwright_diff.regressions))
            lines.append("")
    else:
        lines.append("### ✅ No regressions detected")
        lines.append("")

    if new_flakes:
        lines.append(f"### 🌀 Newly flaky ({len(new_flakes)})")
        lines.append("")
        lines.append("Tests that passed cleanly at baseline and now need a retry. Soft signal — watch.")
        lines.append("")
        lines.append(_bullet_list(new_flakes))
        lines.append("")

    if improvements:
        lines.append(f"### 📈 Known-failing tests now pass ({len(improvements)})")
        lines.append("")
        lines.append("Consider removing these from `known_failing` in `tests/sentinel/baseline.json` so they start gating future runs.")
        lines.append("")
        lines.append(_bullet_list(improvements))
        lines.append("")

    if new_failures:
        lines.append(f"### 🆕 New failures (not in baseline) ({len(new_failures)})")
        lines.append("")
        lines.append("Tests that fail now but aren't in any baseline list. Usually new tests added since baseline — either fix them or add to `known_failing` with a note.")
        lines.append("")
        lines.append(_bullet_list(new_failures))
        lines.append("")

    return ("\n".join(lines).rstrip() + "\n", has_regressions)


# --- Entry point ------------------------------------------------------------


def _load_baseline_suite(
    suite: dict, current: PytestResults | PlaywrightResults, name: str
) -> SuiteDiff:
    return SuiteDiff(
        name=name,
        baseline_pass=set(suite.get("passed", [])),
        baseline_known_failing=set(suite.get("known_failing", [])),
        baseline_known_flaky=set(suite.get("known_flaky", [])),
        current_pass=current.passed,
        current_fail=current.failed,
        current_flaky=getattr(current, "flaky", set()),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--pytest-xml", type=Path, required=True)
    parser.add_argument("--playwright-log", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--step-summary", type=Path, default=None)
    parser.add_argument("--regressions-out", type=Path, default=None)
    parser.add_argument("--baseline-label", default="baseline",
                        help="Human label shown in report header (e.g. 'daily snapshot (2026-05-02)')")
    args = parser.parse_args()

    for label, path in [
        ("baseline", args.baseline),
        ("pytest-xml", args.pytest_xml),
        ("playwright-log", args.playwright_log),
    ]:
        if not path.exists():
            print(f"{label} not found at {path} — cannot compare", file=sys.stderr)
            return 2

    baseline = json.loads(args.baseline.read_text())
    if baseline.get("schema_version") != 1:
        print(
            f"unsupported baseline schema_version={baseline.get('schema_version')}",
            file=sys.stderr,
        )
        return 2

    pytest_cur = parse_pytest_xml(args.pytest_xml)
    playwright_cur = parse_playwright_log(args.playwright_log)

    pytest_diff = _load_baseline_suite(
        baseline.get("pytest", {}), pytest_cur, "pytest"
    )
    playwright_diff = _load_baseline_suite(
        baseline.get("playwright", {}), playwright_cur, "playwright"
    )

    report, has_regressions = render_report(baseline, pytest_diff, playwright_diff, args.baseline_label)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(report)

    if args.step_summary is not None:
        with args.step_summary.open("a") as f:
            f.write(report)

    if args.regressions_out is not None:
        args.regressions_out.write_text("true" if has_regressions else "false")

    # Also dump to stdout for workflow log visibility.
    print(report)
    return 0


if __name__ == "__main__":
    sys.exit(main())
