#!/usr/bin/env python3
"""
generate-snapshot.py — build a daily-snapshot.json from a test run against dev.

Reads the same pytest.xml + playwright run.log inputs as compare-app-tests.py
and outputs a schema_version:1 snapshot. All currently-failing tests are written
into known_failing so future autofix comparisons won't flag them as regressions.

Usage:
  python3 generate-snapshot.py \\
    --pytest-xml /tmp/dev-health/pytest.xml \\
    --playwright-log /tmp/dev-health/run.log \\
    --output tests/sentinel/daily-snapshot.json \\
    --git-ref dev \\
    --workflow-url https://github.com/org/repo/actions/runs/12345
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


def _load_parsers():
    spec = importlib.util.spec_from_file_location(
        "compare_app_tests",
        Path(__file__).parent / "compare-app-tests.py",
    )
    assert spec is not None and spec.loader is not None, "Could not load compare-app-tests.py"
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod.parse_pytest_xml, mod.parse_playwright_log


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pytest-xml", type=Path, required=True)
    parser.add_argument("--playwright-log", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--git-ref", default="dev")
    parser.add_argument("--workflow-url", default="")
    args = parser.parse_args()

    for label, path in [("pytest-xml", args.pytest_xml), ("playwright-log", args.playwright_log)]:
        if not path.exists():
            print(f"{label} not found at {path}", file=sys.stderr)
            return 2

    parse_pytest_xml, parse_playwright_log = _load_parsers()

    pytest_r = parse_pytest_xml(args.pytest_xml)
    playwright_r = parse_playwright_log(args.playwright_log)

    try:
        git_sha = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], text=True, stderr=subprocess.DEVNULL
        ).strip()
    except Exception:
        git_sha = ""

    snapshot = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "git_sha": git_sha,
        "git_ref": args.git_ref,
        "generated_from_workflow_url": args.workflow_url,
        "note": (
            "Daily snapshot of dev branch. Currently-failing tests are in known_failing "
            "and will NOT count as regressions in autofix comparisons — only new failures "
            "introduced by a fix branch will be flagged."
        ),
        "pytest": {
            "total": pytest_r.total,
            "passed_count": len(pytest_r.passed),
            "skipped_count": len(pytest_r.skipped),
            "failed_count": len(pytest_r.failed),
            "passed": sorted(pytest_r.passed),
            "known_failing": sorted(pytest_r.failed),
            "known_flaky": [],
        },
        "playwright": {
            "project": "local",
            "total": playwright_r.total,
            "passed_count": len(playwright_r.passed),
            "flaky_count": len(playwright_r.flaky),
            "failed_count": len(playwright_r.failed),
            "passed": sorted(playwright_r.passed),
            "known_flaky": sorted(playwright_r.flaky),
            "known_failing": sorted(playwright_r.failed),
        },
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(snapshot, indent=2) + "\n")

    print(f"Snapshot written to {args.output}")
    print(f"  git: {args.git_ref} @ {git_sha[:7] if git_sha else 'unknown'}")
    print(f"  pytest:     {len(pytest_r.passed)} passed, {len(pytest_r.failed)} known_failing, {len(pytest_r.skipped)} skipped")
    print(f"  playwright: {len(playwright_r.passed)} passed, {len(playwright_r.flaky)} known_flaky, {len(playwright_r.failed)} known_failing")
    return 0


if __name__ == "__main__":
    sys.exit(main())
