# CloudWarriors AI — Claude Operating Standards

These standards apply to all Claude-assisted development in the CloudWarriors AI org.
Project-level `CLAUDE.md` files take precedence for repo-local behavior.

---

## Core Operating Rules

- Default to action over asking. Ask only when there is genuine ambiguity about direction, an authority boundary, or a destructive/external action.
- Prefer discovering facts from the repo over asking the user for discoverable context.
- Keep the end goal in view. Do not stop at partial analysis when safe momentum remains.
- **Anti-overengineering gate**: No new service, persistence layer, schema, or orchestration engine unless you can prove an existing primitive cannot satisfy the requirement in one sentence. If you cannot prove it in one sentence, it fails.
- Changes exceeding 500 LOC or 3 files require justification before implementation.
- Use `rg` / `rg --files` for search by default.

---

## Execution Loop

- Decompose the task into slices. Each slice: implement → test the changed code → fix failures → next slice.
- Do not report progress between slices. Report when the full task is done or when hitting a hard blocker.
- After completing an edit batch, run typecheck/tests/lint before moving on.
- Fix introduced test failures immediately. Distinguish pre-existing failures (not your problem) from introduced failures (fix before continuing).

---

## Fix-Issue Protocol

1. **LOCATE** — Use the codebase map if available; navigate directly. Minimize broad exploration.
2. **REPRODUCE** — Run existing tests to confirm a clean baseline.
3. **TEST** — Write the minimal failing test that captures the bug. Verify it fails before implementing the fix.
4. **FIX** — Implement the minimal change. No refactors outside the bug surface.
5. **GATE** — Run lint, tests, build. All must pass.
6. **ITERATE** — On failure: read the actual error, trace the call path, form a hypothesis, verify it, then fix. After 3 failures on the same surface, escalate with the exact blocker (file and line).
7. **EXIT** — Success: failing test passes + gates green. Blocked: report exact blocker.

---

## Before Stopping

Ask: is there one more small, local, reversible step that materially improves the result?
- **Continue if**: obvious adjacent improvement, incomplete path to goal, missing verification step clearly in scope.
- **Stop if**: goal satisfied end to end, evidence complete, remaining ideas are speculative or open a new track.

---

## Completion Standards

- No hedging language ("should work", "probably passes"). State what was run, what the output was, and whether it passed or failed.
- Claim completion only when verification has been run and results are cited.
- For non-trivial work, produce both a **Self-Audit** (every requirement addressed, gaps named) and an **Expert Review** (correctness, regressions, failure modes, security, missing tests).

---

## Security Rules

- No secrets, API keys, or credentials in code or commits
- No sensitive data in logs or error messages
- Parameterized queries only — no string-concatenated SQL
- Sanitize all user input at trust boundaries
- Do not modify `.github/workflows/` or `.env*` files without explicit instruction
- Run gitleaks or equivalent secret scan before finalizing changes

---

## Safety and Git Rules

- Never use `git reset --hard`, `git checkout --`, or force-push unless explicitly requested
- Never push to `main`
- Use `fix/issue-<N>` for issue fix branches, `codex/` prefix for other AI-driven branches
- Do not amend published commits
- Prefer non-interactive git commands
- Respect dirty worktrees — do not revert unrelated changes

---

## Output Style

- Concise and direct. No filler, no preamble, no praise.
- For reviews: findings first, ordered by severity, with file:line references.
- Prefer code, diffs, and command output over prose.
- Do not summarize what you just did — the diff speaks for itself.

---

## RLM Codebase Map

When `.rlm-cache/rlm_summary.md` is present, trust it as the authoritative codebase map. Do not re-explore architecture already captured there. Use it to navigate directly to affected modules.

The `rlm-cache` branch stores the persistent map keyed to the last structural commit SHA. The CI workflow updates it automatically on structural changes.
