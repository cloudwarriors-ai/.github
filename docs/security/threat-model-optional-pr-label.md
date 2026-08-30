# Optional autopilot PR label threat model

## Scope and boundaries

The reusable Autopilot finalizer creates or updates a pull request only after
the fix branch, preview deployment, validation, app tests, and project tests
pass. GitHub Actions acts with the existing `WORKFLOW_PAT`; GitHub remains the
authorization boundary for pull-request and label mutations. The change makes
the repository's `autopilot` label optional: pull-request creation completes
first, then the workflow attempts to add the label and records a warning if the
repository does not define it.

The pull request, head/base branches, token, dev-only controls, preview hold,
head-SHA verification, and merge authority are unchanged. Issue and diff
content are INTERNAL. No credential value is written to the pull request or
workflow output.

## Threats and controls

- **Spoofing:** an unrelated branch could be presented as the validated fix.
  The finalizer still supplies the configured head/base explicitly and fails
  closed unless the created PR's `headRefOid` equals the SHA verified earlier
  in the run.
- **Tampering:** failure to apply the optional label could conceal the PR's
  origin. The PR title/body retain the issue, track, validation matrix, preview
  URL, and workflow-run link; label failure is also emitted as a run warning.
- **Repudiation:** a label mutation could otherwise be silent. GitHub records
  the workflow actor and PR events, and the explicit warning records the
  unsuccessful optional mutation.
- **Information disclosure:** PR creation already publishes the issue excerpt,
  file summary, and gate results to the same repository. Separating the label
  mutation adds no new data flow and never interpolates the token.
- **Denial of service:** a missing repository label previously rejected the
  entire `gh pr create` command after every technical gate passed. Creating the
  PR before the best-effort label removes that availability dependency while
  the existing-PR lookup keeps finalization idempotent.
- **Elevation of privilege:** label degradation must not bypass validation or
  grant merge authority. The change runs only after `PR_NUM` is non-empty and
  leaves every release, preview-hold, head-drift, and dev-only gate unchanged.
- **Prompt injection / tool-authority escalation:** issue text remains data in
  the existing quoted PR body and is never evaluated as shell. No model, tool,
  credential, or mutation permission is added by this change.

## Authorization behavior and residual risk

GitHub authorizes PR creation and label mutation for the workflow identity.
Tests assert that the optional label is absent from `gh pr create` and that the
post-creation label command degrades to a warning. Live proof must show a PR is
created in a repository without the label and that the already-verified head
SHA still gates readiness.

Residual risk is limited to reduced label-based discoverability when a caller
repository omits `autopilot`. The PR body, issue linkage, workflow evidence, and
GitHub audit trail remain available; the missing label confers no authority.
