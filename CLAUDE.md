# CloudWarriors AI — Claude Operating Standards

These standards apply to all Claude-assisted development in the CloudWarriors AI org.
Project-level `CLAUDE.md` files take precedence for repo-local behavior.

---

## Iron Rules

**Simple is best.** The simplest solution that fully satisfies the requirement is always the correct one. Complexity must be justified, not defaulted to. When in doubt, do less.

**Anti-overengineering gate**: No new service, persistence layer, schema, or orchestration engine unless you can prove an existing primitive cannot satisfy the requirement in one sentence. If you cannot prove it in one sentence, it fails. Three similar lines of code are better than a premature abstraction.

These two rules are not aspirational — they are hard stops. A solution that is correct but unnecessarily complex is a defect.

---

## Core Operating Rules

- Default to action over asking. Ask only when there is genuine ambiguity about direction, an authority boundary, or a destructive/external action.
- Prefer discovering facts from the repo over asking the user for discoverable context.
- Keep the end goal in view. Do not stop at partial analysis when safe momentum remains.
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

## Filing GitHub Issues

When a user asks you to create a GitHub issue — "file this as an issue," "open a bug
for this," "track this," or similar — follow this standard. The issue you write will
be picked up by another session (possibly another LLM) that has no context from this
conversation.

### Before writing

1. Identify the repository. Use the current working directory's git remote unless the
   user names a different repo.
2. Read `.github/ISSUE_TEMPLATE/` if it exists. Use the repo's template structure.
   If no template exists, use the section order below.
3. Gather the facts from this session: what you observed, what files are involved,
   what the user described, any error output or reproduction steps you have.

### Section order

Write every section. If you genuinely have nothing for a section (no reproduction
steps for a feature request, for example), write "Not applicable" — do not omit the
heading.

- **Problem** — one paragraph. State the observable symptom (bug) or capability gap
  (feature/task) in plain technical English. Complete sentences, no shorthand. Do not
  guess at root cause; state what you observed.
- **Expected result** — what should be true when this is resolved. Specific enough
  that the implementer can verify it: a return value, a UI state, a passing test, a
  behavioral change.
- **Location** — file paths, function names, line numbers, modules, endpoints. Use
  `path/to/file.ext:line` format. For new features, name the files or modules it
  should live in or near. The implementer should open the right file within seconds.
- **Reproduction** — steps or commands that demonstrate the problem. Paste exact error
  output, stack traces, or unexpected return values. For a feature request, describe
  the user action or API call that should work but does not exist. Use code blocks.
- **Scope** — two lists: **In scope** (what this issue covers) and **Out of scope**
  (what it does not). Name adjacent work the implementer might drift into and say it
  is out of scope.
- **Verification** — a command, test, or check the implementer can run to confirm the
  work is done. Name the test file, the curl command, the build check. The implementer
  needs a pass/fail signal, not a description of correctness.
- **Context** — related issues (link them), environment details, constraints, deadlines,
  links to specs or docs. Reference files and URLs — do not paste their contents.

### Writing rules

- Plain technical English. Complete sentences. No telegraphic shorthand.
- Ground every claim in something observable: a file path, an error message, a command
  output, a behavior. Do not write "the auth module seems broken" — write
  "POST /auth/token returns 500 with a KeyError on `refresh_token` in
  `src/auth/handler.py:47`."
- Do not pad. If the issue is two sentences and three file paths, that is fine.
- Use the repo's labels if you know them. Otherwise omit labels — a wrong label is
  worse than no label.
- Title: a short declarative statement of the problem or request — not a description of
  the solution. Good: "POST /auth/token returns 500 on expired refresh token." Bad:
  "Fix auth handler to check token expiry."
- Ask the user to confirm the issue body before creating it, unless they said to file
  it without review.

### Creating the issue

```bash
gh issue create --repo <owner>/<repo> --title "<concise title>" --body "$(cat <<'EOF'
<issue body>
EOF
)"
```

---

## RLM Codebase Map

When `.rlm-cache/rlm_summary.md` is present, trust it as the authoritative codebase map. Do not re-explore architecture already captured there. Use it to navigate directly to affected modules.

The `rlm-cache` branch stores the persistent map keyed to the last structural commit SHA. The CI workflow updates it automatically on structural changes.

