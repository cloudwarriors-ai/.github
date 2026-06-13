# CloudWarriors Autopilot — Onboarding Guide

This guide walks a new repository through enabling the CloudWarriors Autopilot pipeline (issue → autofix → preview → validate → PR).

**Realistic onboarding time:** 30–60 minutes for a typical web application. Faster for a CLI / package / API-only service that does not need preview deploys.

---

## 1. Architecture (read this first)

The autopilot is built from reusable workflows distributed across two organization repositories:

| Repo | Owns |
|------|------|
| `cloudwarriors-ai/.github` | Intake, runner, validation, deploy/teardown, finalize, scripts, schemas, this guide |
| `cloudwarriors-ai/workflows` | RLM autofix engine (codebase analysis + Claude adversarial auto-fix) |

Your consumer repository calls these. **You do not maintain copies of the pipeline logic.** Upgrades happen by repinning the `uses:` ref.

---

## 2. Prerequisites

### Organization secrets (one-time, org-wide)
These must exist on `cloudwarriors-ai` and be inherited by your repo. Verify with org admin if unsure:

- `WORKFLOW_PAT` — PAT with `repo`, `workflow`, `issues:write` scopes
- `OPENROUTER_API_KEY` — powers RLM analysis and Claude autofix
- `ANTHROPIC_API_KEY` — optional, deprecated (rollback to direct Anthropic billing only)

### Conditional secrets (only if your repo uses these features)

| Feature | Required secrets |
|---------|------------------|
| Preview deploy via VPS SSH | `SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY`, `VPS_REPO_PATH` (variable) |
| Sentinel API validation | `VALIDATION_ATTESTATION_KEY` |
| Behavioral / E2E tests | `E2E_EMAIL`, `E2E_PASSWORD` |
| Database integration | `DATABASE_URL`, `PII_ENCRYPTION_KEY`, `PII_HMAC_KEY` |

### GitHub Environments (one-time per repo)
Create two environments matching your branching model:
- `dev` (used when `base: dev`)
- `production` (used when `base: main`)

Each environment inherits the conditional secrets above. Use Environments to enforce required-reviewer rules on production deploys if you want a manual gate.

---

## 3. Files to add to your repo

### 3a. `.github/workflows/autopilot-intake.yml`

Thin caller. Triggered when an issue gets the `AUTOPILOT: Enabled` label or a comment matching the intake pattern. **Use the workflow template** to scaffold:

```bash
mkdir -p .github/workflows
curl -L -o .github/workflows/autopilot-intake.yml \
  https://raw.githubusercontent.com/cloudwarriors-ai/.github/v1/workflow-templates/autopilot-caller.yml
```

Or hand-write the trigger; the template above pins to `@v1` (current stable). Avoid `@main` for stable consumers.

### 3b. `.github/workflows/autopilot-runner.yml`

Dispatched by intake; runs the actual autofix. Minimal contents:

```yaml
name: Autopilot Runner
on:
  workflow_dispatch:
    inputs:
      issue_number: { required: true, type: string }
      issue_title:  { required: false, type: string }
      track:        { required: true, type: string }
      base:         { required: true, type: string }
      head:         { required: true, type: string }

jobs:
  run:
    uses: cloudwarriors-ai/.github/.github/workflows/reusable-autopilot-runner.yml@v1
    with:
      issue_number: ${{ inputs.issue_number }}
      issue_title:  ${{ inputs.issue_title }}
      track:        ${{ inputs.track }}
      base:         ${{ inputs.base }}
      head:         ${{ inputs.head }}
    secrets: inherit
```

### 3c. `.autopilot/config.json`

Tells the runner how to build, lint, test, deploy, and validate your project. Required keys:

```json
{
  "name": "your-repo-name",
  "runtime": "node",
  "packageManager": "npm",
  "buildCommand": "npm run build",
  "lintCommand": "npm run lint",
  "testCommand": "npm test",
  "appTestCommand": "",
  "dbMigrateCommand": "",
  "testPatterns": ["**/*.test.ts", "**/*.spec.ts"],
  "assertionPatterns": ["expect(", "assert("],
  "healthEndpoint": "/health",
  "containerName": "app",
  "previewDeploy": false,
  "mergeRequirements": {
    "minApprovals": 1,
    "requiredChecks": []
  },
  "validation": {
    "state": "pending_onboarding"
  }
}
```

**Key choices:**

- `runtime`: `node` | `python` | `go` | `ruby` | `java` — controls how dependencies are installed in the runner.
- `previewDeploy`: set `true` only if you have VPS deploy scripts (see §4 below).
- `validation.state`:
  - `"pending_onboarding"` — Sentinel validation skipped (recommended for first 1–2 weeks).
  - `"active"` — Sentinel runs against the preview URL using `.autopilot/validation.json`.
  - `"exempt"` — Sentinel skipped permanently (only for repos that genuinely don't need API validation).

### 3d. `.autopilot/validation.json` (only if `validation.state == "active"`)

Sentinel manifest. Use the [Sentinel docs](https://github.com/cloudwarriors-ai/sentinel) for the schema. Required for active validation; absent file = pipeline blocks.

### 3e. `.autopilot/claude-prompt.md` (optional)

Project-specific guidance for the RLM/Claude auto-fix step. Use to encode constraints the codebase can't express (e.g., "FK `on_delete=DO_NOTHING` is banned", "API responses must include `request_id`"). Free-form markdown.

---

## 4. Preview deploy (optional, advanced)

Skip this section if `previewDeploy: false`.

If you want preview deploys, you need:

- `scripts/preview-deploy.sh <ref> <issue-number>` — your script. Runner SSHes to `SSH_HOST`, `cd $VPS_REPO_PATH`, and calls this. Convention: deploys the branch under preview URL `https://preview-<issue-number>.<domain>` and a backend at `https://preview-<issue-number>-api.<domain>`.
- `scripts/preview-teardown.sh <issue-number>` — symmetrical teardown after PR merges or run completes.
- `docker-compose.preview.yml` (or equivalent) — your runtime orchestration. Up to you.
- `VPS_REPO_PATH` repo/org variable — path on the VPS where your repo lives.

The runner now retries preview deploy twice (15s/60s backoff). If both attempts fail, downstream Sentinel + app-test jobs **skip** and the PR is still created with `STATUS: Follow-Up Required` so you know preview infra is unhealthy without losing the autofix output.

---

## 5. Smoke test (do this before merging onboarding)

1. Push the files above to a feature branch and open a PR titled "feat: enable autopilot".
2. Merge to your default branch.
3. Open a test issue titled "Autopilot smoke test" with the label `AUTOPILOT: Enabled`. Description: a trivial change like "Add a comment to README.md saying 'autopilot reachable'".
4. Watch the workflow runs in Actions. Expect:
   - `autopilot-intake.yml` → success (~30s)
   - `autopilot-runner.yml` → 10–20 min depending on RLM scope
5. Look at the issue:
   - **PR should be linked from a comment.** This is the load-bearing signal — `pr_ready` is true even if downstream jobs (Sentinel, preview) had issues.
   - Look for the `<!-- AUTOPILOT_FOLLOWUP -->` comment if any gate failed. It now shows a per-gate breakdown with the failure category (e.g., `transient-http`, `preview-unreachable`).
6. Close the test PR and the test issue.

**Smoke passes if a PR is created and the gate breakdown reflects expected behavior.**

---

## 6. Reading the run result

Distinguish two signals:

| Signal | Meaning |
|--------|---------|
| **Run conclusion** (red/green in Actions UI) | Did *every* job pass? Includes infrastructure (preview, Sentinel). Will be red if preview-deploy or Sentinel hit infra flake even when the PR was successfully created. |
| **`STATUS: In QA` label on the issue** | Bundle validation + preflight + Sentinel all passed. PR is ready for human review. |
| **`STATUS: Follow-Up Required` label** | PR was created but at least one downstream gate failed. The `AUTOPILOT_FOLLOWUP` comment names which one. |
| **No PR comment** | Pipeline halted before PR creation. Usually means bundle validation or preflight failed — actual code-gen problem. |

The Follow-Up comment now includes a recommendation, e.g.:
- `Likely infrastructure flake. Consider re-running the API Validate job or merging if the PR diff itself looks good.`
- `Sentinel detected an API regression — review the validation report before merging.`

---

## 7. Repo variables (optional)

| Variable | Effect |
|----------|--------|
| `SHADOW_ENABLED=true` | Routes autopilot through your `<repo>-shadow` repo instead of running directly on the source. Useful for development. |
| `DEPLOY_ENABLED=false` | Kill switch — disables preview deploy without removing config. Set per environment. |
| `VPS_REPO_PATH` | Path on VPS where preview-deploy.sh expects to run. |

---

## 8. Versioning

- Stable consumers use `@v1` (or pin to an exact `@v1.0.0`).
- Avoid `@main` — breaking changes can land without warning.
- See `RELEASING.md` in this repo for the version compatibility rules between `.github` and `workflows`.

---

## 9. Troubleshooting

**Intake skipped:**
The intake correctly rejects issues that don't match required labels. Check the issue has `AUTOPILOT: Enabled` and the right track label.

**Runner shows red but PR exists:**
This is normal under V6 semantics. Check the `STATUS:` label on the issue and the `AUTOPILOT_FOLLOWUP` comment for the gate breakdown.

**Sentinel `transient-http` failures repeatedly:**
The retry now handles transient TCP issues automatically. Persistent transient-http means the preview environment is genuinely unreachable — check the VPS health.

**`preview_deployed: false`:**
VPS deploy failed twice. Check `SSH_HOST` is reachable, `VPS_REPO_PATH` exists, and `preview-deploy.sh` is executable. The PR will still be created with the `Follow-Up Required` label.

**Onboarding a non-web project (CLI, package, batch):**
Set `previewDeploy: false`, `validation.state: "exempt"`, and `appTestCommand: ""`. The runner will skip all preview-dependent jobs and produce a PR after bundle validation + tests. This is the recommended starting config for any non-web target.

---

## 10. Where to ask for help

Open an issue at `cloudwarriors-ai/.github` with the `autopilot` label. Include:
- A link to the runner workflow run
- Your `.autopilot/config.json`
- The `AUTOPILOT_FOLLOWUP` comment body if present
