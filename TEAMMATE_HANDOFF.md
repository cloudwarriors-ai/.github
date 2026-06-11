# Autopilot Handoff Guide — for teammates onboarding a new application

This doc walks you through everything you need to **(a) set up autopilot on a new repository**, **(b) understand the source/shadow split**, and **(c) trigger your first test run end-to-end**.

If you have a working CloudWarriors GitHub account, can read this repo, and have org-admin or repo-admin permissions on the target app, you can complete onboarding in 30–60 minutes (no preview deploy) or ~90 min (with VPS preview deploy + Sentinel).

---

## 1. Mental model — two modes

Autopilot ships in two execution modes. **You need to decide upfront which one applies.**

### Mode A — Direct mode (autopilot runs on the source repo)

```
   GitHub issue                  GitHub Actions on <your-repo>
   (label: AUTOFIX: Ready)  ──►  autopilot-intake.yml
                                       │
                                       ▼
                                 autopilot-runner.yml
                                       │
                                       ▼ (calls reusable in cloudwarriors-ai/.github@v1.0.x)
                                 RLM analysis → Claude fix → Validate → Preflight
                                 → Preview deploy → Tests → Sentinel API → Finalize
                                       │
                                       ▼
                                 PR on <your-repo> labeled STATUS: In QA
```

**Use direct mode when:**
- The repo is internal/experimental
- You don't need a separation between autopilot work and human work
- You haven't set up a shadow repo

### Mode B — Shadow mode (recommended for production apps)

```
   <your-repo> issue                <your-repo>-shadow             cloudwarriors-ai/.github
   (label: AUTOFIX: Ready)          (mirrored on hourly sync)         (reusables)
        │                                  │                               │
        ▼                                  ▼                               │
   intake fires, sees                Shadow Pipeline (claude-ci.yml)       │
   SHADOW_ENABLED=true,              detects AUTOFIX: Ready on shadow      │
   posts a comment,                  issue, calls intake ─────────────────►│
   exits                                                                  ─┘
                                                                           │
                                                                           ▼
                                                         autopilot-runner pipeline
                                                                           │
                                                                           ▼
                                                         Fix pushed to shadow repo
                                                         PR on <your-repo>-shadow
                                                         (auto-merge if configured)
                                                                           │
                                                                           ▼
                                                         Shadow Upstream PR fires after merge,
                                                         opens corresponding PR on <your-repo>
```

**Use shadow mode when:**
- The repo is production / customer-facing
- You want autopilot's experimental commits isolated until validated
- You want human review on the upstream PR before changes hit the source repo
- The repo has VPS preview deploy that you don't want autopilot to spam

**Scopely uses shadow mode.** The rest of this doc shows both paths.

---

## 2. Required org-level secrets (one-time, set once per CloudWarriors org)

Org admin sets these in **`cloudwarriors-ai` Settings → Secrets and variables → Actions → New organization secret**. Repos inherit via `secrets: inherit` in caller workflows.

### Always required

| Secret | Purpose | Sample value |
|---|---|---|
| `WORKFLOW_PAT` | Personal access token with `repo`, `workflow`, `issues:write` scopes — used by cross-repo actions (script clone, PR creation, comment posting) | `ghp_...` (rotate every 90 days) |
| `ANTHROPIC_API_KEY` | Powers Claude in the RLM autofix step | `sk-ant-...` |
| `OPENROUTER_API_KEY` | Powers RLM codebase analysis | `sk-or-...` |

### Required if your repo uses VPS preview deploy

| Secret | Purpose |
|---|---|
| `SSH_HOST` | DNS / IP of the VPS that hosts preview environments |
| `SSH_USER` | Username for the deploy account |
| `SSH_PRIVATE_KEY` | Private key matching the deploy user (RSA or ed25519) |

### Required if your repo uses Sentinel API validation

| Secret | Purpose |
|---|---|
| `VALIDATION_ATTESTATION_KEY` | Signs the Sentinel report attestation so the verdict is tamper-evident |
| `E2E_EMAIL` | Test user email for the preview environment (Sentinel uses this to log in) |
| `E2E_PASSWORD` | Test user password |

### Required if your repo uses database integration tests

| Secret | Purpose |
|---|---|
| `DATABASE_URL` | Connection string for the preview database |
| `PII_ENCRYPTION_KEY` | Fernet key for at-rest PII encryption (if your repo uses PII encryption) |
| `PII_HMAC_KEY` | HMAC key for hashed email lookup (paired with `PII_ENCRYPTION_KEY`) |

---

## 3. Required repository variables

These live in **your repo Settings → Secrets and variables → Actions → Variables tab** (NOT secrets — variables are visible, secrets are not).

### On the source repo

| Variable | Mode A direct | Mode B shadow | Effect |
|---|---|---|---|
| `SHADOW_ENABLED` | Leave unset (or `false`) | Set to `true` | When `true`, source intake exits with a comment instead of running autopilot |
| `DEPLOY_ENABLED` | `true` (or unset, default true) | n/a for source | When `false`, kills the VPS deploy step (useful as an emergency kill switch) |
| `VPS_REPO_PATH` | `/srv/<your-repo>` (where preview-deploy.sh lives on the VPS) | n/a for source | Path on VPS where deploy scripts run |

### On the shadow repo

| Variable | Recommended value | Effect |
|---|---|---|
| `AUTOQUEUE_ENABLED` | `false` initially, flip to `true` when you trust the pipeline | When `true`, the hourly issue sync auto-stamps `AUTOFIX: Ready` on shadow issues where the source has it. Queue drain then dispatches only up to available runner slots. When `false`, you must label manually on the shadow side. |
| `DEPLOY_ENABLED` | `true` | Same semantics as source — kill switch |
| `VPS_REPO_PATH` | Same path as source (shadow deploys into the SAME preview env via the source repo's deploy path) | Required for VPS preview deploy |

---

## 4. Required GitHub Environments (per source repo)

Create two GitHub Environments in **your repo Settings → Environments**:

- `dev` — used when an autopilot issue has `ENV: Dev` label (or default)
- `production` — used when an autopilot issue has `ENV: Prod` label (or base branch is `main`)

You can attach environment-level secrets here that override org defaults (e.g., a different `DATABASE_URL` for prod vs dev). For most setups, the org secrets suffice and these environments are just gates for required-reviewer rules on prod deploys.

---

## 5. Files your repo must contain

### `.github/workflows/autopilot-intake.yml` (Mode A — source intake)

Required on the **source repo** for both modes. Minimal contents:

```yaml
name: "Autopilot: Intake"

on:
  issues:
    types: [labeled, opened, reopened]
  issue_comment:
    types: [created]

jobs:
  intake:
    uses: cloudwarriors-ai/.github/.github/workflows/reusable-autopilot-intake.yml@v1.0.2
    with:
      issue_number: ${{ github.event.issue.number }}
    secrets: inherit
```

The reusable handles label gating, shadow-guard, and dispatching the runner. Pin to `@v1.0.2` (current stable) — avoid `@main` so breaking changes don't silently land.

### `.github/workflows/autopilot-runner.yml`

Required on the **source repo (Mode A)** and on the **shadow repo (Mode B)**. Minimal contents:

```yaml
name: "Autopilot: Runner"

on:
  workflow_dispatch:
    inputs:
      issue_number: { required: true, type: string }
      issue_title:  { required: false, type: string, default: '' }
      track:        { required: true, type: string }
      base:         { required: true, type: string, default: 'dev' }
      head:         { required: true, type: string }

jobs:
  run:
    uses: cloudwarriors-ai/.github/.github/workflows/reusable-autopilot-runner.yml@v1.0.2
    with:
      issue_number: ${{ inputs.issue_number }}
      issue_title:  ${{ inputs.issue_title }}
      track:        ${{ inputs.track }}
      base:         ${{ inputs.base }}
      head:         ${{ inputs.head }}
      max_claude_turns: 10
      max_rlm_cost: 2
    secrets: inherit
```

### `.github/workflows/claude-ci.yml` (Mode B only — Shadow Pipeline)

Required on the **shadow repo only**. This is the entry point for the shadow side — handles `AUTOFIX: Ready` labels, hourly code/issue sync, and upstream PR creation after shadow merges. It is installed automatically when the shadow repo is created via `reusable-shadow-create.yml` (see §7), but if you need to add it manually, the canonical version is in `workflow-templates/cloudwarriors-shadow-pipeline.yml` in this repo.

### `.autopilot/config.json`

Required wherever the runner runs. For Mode A, lives on the source repo. For Mode B, lives on the shadow repo (the shadow create workflow copies it from source).

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
    "requiredChecks": [],
    "autoMerge": false
  },
  "validation": {
    "state": "pending_onboarding"
  }
}
```

**Key choices:**

| Field | Options | When to use which |
|---|---|---|
| `runtime` | `node`, `python`, `go`, `ruby`, `java` | Determines how dependencies are installed in the Test job |
| `packageManager` | `npm`/`pnpm`/`yarn` (node), `pip`/`uv`/`poetry` (python), `go`, `bundler`, `maven`, `gradle` | Must match runtime |
| `previewDeploy` | `true` or `false` | `true` requires `scripts/preview-deploy.sh` and `scripts/preview-teardown.sh`; otherwise leave `false` |
| `validation.state` | `pending_onboarding`, `active`, `exempt` | Start with `pending_onboarding` for 1–2 weeks (Sentinel skips). Flip to `active` after you've authored `.autopilot/validation.json` and verified Sentinel works |
| `mergeRequirements.autoMerge` | `true` or `false` | `true` causes the runner to auto-merge the PR immediately after creation (use for trivial automated fixes in shadow mode only) |

### `.autopilot/validation.json` (optional, but required if `validation.state: "active"`)

Sentinel manifest. See [cloudwarriors-ai/sentinel](https://github.com/cloudwarriors-ai/sentinel) for the full schema. Minimal example:

```json
{
  "name": "your-repo-name",
  "schemaVersion": "1",
  "healthEndpoint": "/health/",
  "auth": {
    "style": "jwt_bearer",
    "loginEndpoint": "/api/v1/auth/login/",
    "credentialEnv": {
      "email": "E2E_EMAIL",
      "password": "E2E_PASSWORD"
    },
    "tokenPath": "access",
    "header": "Authorization",
    "headerFormat": "Bearer {token}"
  },
  "scenarios": {
    "dir": "validation/scenarios",
    "include": ["**/*.yml"]
  },
  "goldens": {
    "dir": "validation/fixtures/golden"
  }
}
```

### `.autopilot/claude-prompt.md` (optional)

Free-form markdown read by the RLM/Claude auto-fix step. Use for project-specific constraints Claude won't infer from the code (e.g., "FK `on_delete=DO_NOTHING` is banned", "API responses must include `request_id`"). Skip if you don't need it.

### `scripts/preview-deploy.sh` + `scripts/preview-teardown.sh` (only if `previewDeploy: true`)

Your repo's responsibility. The runner SSHes to `SSH_HOST` as `SSH_USER` and runs:

```bash
cd "$VPS_PATH"
git fetch origin dev --depth 1
git checkout origin/dev -- scripts/ .autopilot/
"$VPS_PATH/scripts/preview-deploy.sh" "$DEPLOY_HEAD" "$DEPLOY_ISSUE"
```

Your `preview-deploy.sh` should:
- Check out the head branch
- Build/install
- Bring up a containerized preview at `https://preview-<issue>.<your-domain>` (and optionally `https://preview-<issue>-api.<your-domain>`)
- Wait until the health endpoint returns 2xx

Your `preview-teardown.sh` removes the preview on PR close.

---

## 6. Setup walkthrough — Mode A (Direct)

For a fresh repo with no shadow needed:

```bash
# 1. Clone your repo
git clone https://github.com/<your-org>/<your-repo>
cd <your-repo>

# 2. Branch from dev (or main if dev doesn't exist)
git checkout -b feat/enable-autopilot

# 3. Create directory structure
mkdir -p .github/workflows .autopilot

# 4. Copy intake + runner from this guide (§5 above)
# Or use the workflow templates:
curl -L -o .github/workflows/autopilot-intake.yml \
  https://raw.githubusercontent.com/cloudwarriors-ai/.github/main/workflow-templates/autopilot-caller.yml
# (then write autopilot-runner.yml manually using the template in §5)

# 5. Create .autopilot/config.json (see §5 for shape)

# 6. Commit, push, open PR, merge

# 7. Verify the org-level secrets are inheritable to your repo
gh secret list --org cloudwarriors-ai

# 8. Set repo variables (skip SHADOW_ENABLED for direct mode)
gh variable set DEPLOY_ENABLED --body "true"
gh variable set VPS_REPO_PATH --body "/srv/your-repo"   # only if previewDeploy: true

# 9. Create GitHub Environments
gh api -X PUT "repos/<your-org>/<your-repo>/environments/dev"
gh api -X PUT "repos/<your-org>/<your-repo>/environments/production"
```

You're ready. Skip to §9 to run your first test.

---

## 7. Setup walkthrough — Mode B (Shadow, recommended for production)

### One-time: create the shadow repo

Manually dispatch the org's shadow-create workflow:

```bash
gh workflow run reusable-shadow-create.yml \
  --repo cloudwarriors-ai/.github \
  --ref main \
  -f source_repo=<your-org>/<your-repo>
```

This will:
- Create `cloudwarriors-ai/shadow-<your-org>-<your-repo>` (lower-cased, dash-separated)
- Push your source code to it
- Write `.shadow/config.json` mapping source ↔ shadow
- Install `claude-ci.yml` (the Shadow Pipeline)
- Trigger an initial issue sync

Watch the run; on success it prints the shadow repo's URL.

### Configure variables on both repos

**Source repo:**

```bash
gh variable set SHADOW_ENABLED --body "true" --repo <your-org>/<your-repo>
gh variable set DEPLOY_ENABLED --body "true" --repo <your-org>/<your-repo>
gh variable set VPS_REPO_PATH  --body "/srv/your-repo" --repo <your-org>/<your-repo>
```

**Shadow repo:**

```bash
gh variable set AUTOQUEUE_ENABLED --body "false" --repo cloudwarriors-ai/<shadow-name>   # start off
gh variable set DEPLOY_ENABLED --body "true" --repo cloudwarriors-ai/<shadow-name>
gh variable set VPS_REPO_PATH --body "/srv/your-repo" --repo cloudwarriors-ai/<shadow-name>
```

`AUTOQUEUE_ENABLED=false` initially means: the hourly sync mirrors issues to shadow but does NOT auto-label them. You manually label `AUTOFIX: Ready` on the shadow side to trigger autopilot. Flip to `true` after you trust the pipeline. Once enabled, more than 5 ready issues can sit queued; the queue drain starts the oldest eligible issues as runner slots open.

### Authoring `.autopilot/config.json` on the shadow

The shadow create workflow tries to seed this for you, but **verify it exists** and adjust:

- `previewDeploy: true` (shadow deploys go to the same VPS path as source)
- `mergeRequirements.autoMerge: true` — recommended for shadow because the upstream PR provides the human review gate

### Confirm the hourly sync works

The Shadow Pipeline runs `schedule: cron '15 * * * *'` (every hour at :15). You can force an immediate sync:

```bash
gh workflow run claude-ci.yml --repo cloudwarriors-ai/<shadow-name> -f action=full-sync
```

After it completes, every open issue from source should have a counterpart on shadow.

---

## 8. The complete variable + secret matrix

| Type | Where | Name | Required | Used by |
|---|---|---|---|---|
| Org secret | `cloudwarriors-ai` | `WORKFLOW_PAT` | Always | All cross-repo actions |
| Org secret | `cloudwarriors-ai` | `ANTHROPIC_API_KEY` | Always | RLM Claude auto-fix |
| Org secret | `cloudwarriors-ai` | `OPENROUTER_API_KEY` | Always | RLM codebase analysis |
| Org secret | `cloudwarriors-ai` | `SSH_HOST` | If `previewDeploy: true` | Deploy Preview job |
| Org secret | `cloudwarriors-ai` | `SSH_USER` | If `previewDeploy: true` | Deploy Preview job |
| Org secret | `cloudwarriors-ai` | `SSH_PRIVATE_KEY` | If `previewDeploy: true` | Deploy Preview job |
| Org secret | `cloudwarriors-ai` | `VALIDATION_ATTESTATION_KEY` | If `validation.state: "active"` | Sentinel attestation signing |
| Org secret | `cloudwarriors-ai` | `E2E_EMAIL` | If `validation.state: "active"` or `appTestCommand` set | Sentinel login + E2E auth |
| Org secret | `cloudwarriors-ai` | `E2E_PASSWORD` | Same | Same |
| Org secret | `cloudwarriors-ai` | `DATABASE_URL` | If preview env uses Postgres | Deploy preview + app tests |
| Org secret | `cloudwarriors-ai` | `PII_ENCRYPTION_KEY` | If app uses Fernet PII encryption | Backend container env |
| Org secret | `cloudwarriors-ai` | `PII_HMAC_KEY` | Same | Same |
| Repo variable | source repo | `SHADOW_ENABLED` | Mode B only | Intake shadow-guard |
| Repo variable | source repo | `DEPLOY_ENABLED` | If `previewDeploy: true` | Deploy Preview kill switch |
| Repo variable | source repo | `VPS_REPO_PATH` | If `previewDeploy: true` | SSH `cd $VPS_PATH` |
| Repo variable | shadow repo | `AUTOQUEUE_ENABLED` | Mode B only | Hourly issue sync auto-label |
| Repo variable | shadow repo | `DEPLOY_ENABLED` | Mode B + `previewDeploy: true` | Deploy Preview kill switch |
| Repo variable | shadow repo | `VPS_REPO_PATH` | Mode B + `previewDeploy: true` | SSH `cd $VPS_PATH` |
| Env / `dev` | source + shadow | (any per-env overrides) | Optional | Per-environment overrides |
| Env / `production` | source + shadow | (any per-env overrides) | Optional | Per-environment overrides |

---

## 9. Running your first autopilot test

### The trigger label

`AUTOFIX: Ready` on an issue triggers the autopilot.

You also need exactly ONE of these track labels:
- `TRACK: Bug`
- `TRACK: Feature`

And exactly ONE of these env labels (optional — defaults to dev):
- `ENV: Dev`
- `ENV: Prod`

### Mode A — direct test

```bash
# Create a trivial test issue
gh issue create --repo <your-org>/<your-repo> \
  --title "Smoke: autopilot end-to-end test" \
  --label "AUTOFIX: Ready,TRACK: Bug,ENV: Dev" \
  --body "Add a single-line docstring to <some-module>. Trivial scope for smoke test."
```

Then watch:

```bash
# Tail the runs
gh run watch --repo <your-org>/<your-repo>

# Or list recent runs
gh run list --repo <your-org>/<your-repo> --workflow autopilot-runner.yml --limit 3
```

### Mode B — shadow test

```bash
# Option 1 — label on source, let the sync flow handle the rest
# (Requires AUTOQUEUE_ENABLED=true on shadow; otherwise also label on shadow)
gh issue create --repo <your-org>/<your-repo> \
  --title "Smoke: autopilot end-to-end test" \
  --label "AUTOFIX: Ready,TRACK: Bug,ENV: Dev" \
  --body "Trivial scope."

# Option 2 — direct on shadow (skips waiting for hourly sync)
gh issue create --repo cloudwarriors-ai/<shadow-name> \
  --title "Smoke: autopilot end-to-end test" \
  --label "AUTOFIX: Ready,TRACK: Bug,ENV: Dev" \
  --body "Trivial scope."
```

### What to expect during the run (read these comments on the issue)

You should see these comments appear over ~10–20 minutes regardless of outcome:

1. `🔍 RLM codebase analysis complete. Starting adversarial fix workflow...`
2. `✅ Auto-fix complete! Changes pushed to autofix/issue-N targeting dev. PR will be created by the pipeline.`

After that, the outcome depends on whether every gate passed.

#### Happy path — everything green (the goal)

If bundle validation + preflight + tests + (preview deploy + Sentinel + app tests if configured) all pass:

- The issue gets labeled **`STATUS: In QA`**
- A PR is created and linked from the issue
- **No `AUTOPILOT_FOLLOWUP` comment is posted** (the structured comment only fires on failure)
- The Actions run conclusion is green

This is what a freshly-configured autopilot looks like against current code. Reference smoke: run [25888968713](https://github.com/cloudwarriors-ai/scopely-shadow/actions/runs/25888968713) on `cloudwarriors-ai/scopely-shadow#284` — all 11 jobs green, PR #286 created, issue labeled `STATUS: In QA`, no Follow-Up comment.

#### Degraded path — something failed but a PR was still created

If bundle validation and preflight passed but a downstream gate (preview deploy, Sentinel, project tests, or app tests) failed:

- The issue gets labeled **`STATUS: Follow-Up Required`**
- A PR is still created (you can still merge it if you decide the diff is good)
- An `AUTOPILOT_FOLLOWUP` comment is posted with a per-gate breakdown like:

```
✅ PR #N created — ready for human review

| Gate              | Result                                |
| Bundle validation | ✅ true                                |
| Preflight         | ✅ true                                |
| Preview deploy    | ✅ true                                |
| Project tests     | ❌ false                               |
| Sentinel API      | ❌ false — reason: `auth-failed`       |
| App tests (E2E)   | ✅ true                                |

Recommendation: Sentinel could not authenticate against the preview (HTTP 401).
The E2E_EMAIL / E2E_PASSWORD org secrets may not match the preview environment.
```

The example above shows a **degraded** run for illustration — it is NOT what a healthy first-run should look like. If your smoke produces this on a known-good preview environment, treat the `reason:` tag as a real diagnostic signal and act on the recommendation.

#### Halted path — pipeline stopped before PR creation

If bundle validation or preflight failed (the autopilot's own code-gen failed in a way that can't proceed):

- No PR is created
- The issue keeps its `STATUS: In Progress` label or reverts to whatever it had
- The Actions run conclusion is red
- This is the only outcome that means the autopilot itself failed (as opposed to downstream infra)

#### `reason:` taxonomy (only appears on degraded path)

| Reason | Meaning | Action |
|---|---|---|
| `auth-failed` | HTTP 401 from auth endpoint | E2E creds wrong or user locked out |
| `auth-forbidden` | HTTP 403 from auth endpoint | E2E user lacks permissions |
| `preview-unreachable` | DNS / connection refused | VPS deploy didn't actually serve the preview |
| `transient-http` | TCP / RemoteProtocolError | Real flake — retry the API Validate job |
| `goldens-drift` | Sentinel found unauthorized API changes | Review the report — endpoint contract changed |
| `regression` | Sentinel found assertion failures | Review the validation report |
| `sentinel-internal` | None of the above | Inspect logs |

### Read the run color the right way

| Signal | Meaning |
|---|---|
| GitHub Actions run conclusion = success (green) | All jobs green |
| GitHub Actions run conclusion = failure (red) | At least one downstream job failed (often just infra), **but the PR may still be created** |
| Issue label `STATUS: In QA` | All required gates passed — PR ready for human review |
| Issue label `STATUS: Follow-Up Required` | PR was created but at least one gate failed — read the structured comment |
| Issue label none / unchanged | Pipeline never reached Finalize — usually means bundle validation or preflight failed |

---

## 10. Teammate test exercise

Hand this exercise to whoever is testing the pipeline:

1. **Read this guide and pick a low-risk repo** (a sandbox or an experimental service).
2. **Decide Mode A or Mode B.** For first-time testers, pick Mode A unless you specifically need shadow isolation.
3. **Verify org secrets exist** — `gh secret list --org cloudwarriors-ai` should show the secrets listed in §2 you'll need.
4. **Set up the repo per §6 (Mode A) or §7 (Mode B).** Commit, push, merge the autopilot-enabling PR.
5. **Create a trivial test issue per §9.** Pick a change like "add a one-line docstring" — keep scope minimal.
6. **Wait 10–20 min and observe.** Do not interfere with the run.
7. **Report back on these questions:**
   - Did the issue receive the RLM-complete + auto-fix-complete comments?
   - Did a PR get created?
   - What `STATUS:` label did the issue end up with?
   - If `Follow-Up Required` — was the structured comment present? Did the reason category match reality?
   - If anything was confusing or unexpected, what was it?
8. **Close the test issue and discard the test PR.**

We want feedback on:
- Was anything in this guide unclear or wrong?
- Did the run take longer than expected?
- Did any required secret/variable get missed in §2/§3?
- Did the Follow-Up comment give you enough info to debug without log-diving?

---

## 11. Troubleshooting common issues

**Intake conclusion = skipped:**
The intake correctly rejects issues missing required labels. Confirm `AUTOFIX: Ready` + a `TRACK:` label.

**Intake conclusion = failure with "Shadow-enabled — execution blocked at source":**
Expected on Mode B source repos. The fix runs on the shadow side. Check the comment on the issue for the shadow link.

**Runner shows red but the PR exists:**
Normal — V6 separates "PR ready" from "every job green." Check the issue's `STATUS:` label and the `AUTOPILOT_FOLLOWUP` comment.

**Sentinel `auth-failed` failures:**
Most common cause: E2E user got locked out by django-axes from prior failed runs (lockout threshold = 5 failed attempts, 15-min cooloff). Reset via `python manage.py axes_reset_username <E2E_EMAIL>` on the backend container, or just wait 15 min and retry.

**Sentinel `preview-unreachable`:**
VPS deploy succeeded but the preview URL isn't actually serving traffic. Check Traefik routes, DNS, and the preview container's health endpoint.

**`preview_deployed: false`:**
VPS SSH deploy failed twice. Check `SSH_HOST` reachability, `VPS_REPO_PATH` exists, and `preview-deploy.sh` is executable. PR will still be created with `Follow-Up Required` label.

**The PR creates against the wrong base branch:**
Check the issue's `ENV:` label. `ENV: Dev` → `dev`; `ENV: Prod` → `main`. Default is `dev`.

**The autofix branch is from an old base and breaks on current code:**
This happens when autopilot re-runs on stale autofix branches (e.g., `autofix/issue-475` from 3 weeks ago against current dev). The branch's code may not include URLs/migrations/changes that landed since. **Recommendation:** close the stale autofix branch and let autopilot generate a fresh one by re-triggering on the issue.

---

## 12. Versioning

This repo (`cloudwarriors-ai/.github`) uses SemVer for reusable workflows:

- **MAJOR** = breaking input/secret/output changes — bump major when introducing
- **MINOR** = new optional input, additive job, or safe new behavior
- **PATCH** = bug fix with no contract change

Pin consumers to `@v1.0.x` (exact) for stability or `@v1` (floating major) for non-breaking auto-upgrades. **Never use `@main` in stable consumers** — breaking changes can land at any time.

`cloudwarriors-ai/.github` and `cloudwarriors-ai/workflows` (the RLM engine repo) share major versions. If you ever see version skew between them, the runner detects it and emits `AUTO_DOCTOR_TWO_REPO_001` in the Follow-Up comment.

---

## 13. Need help?

- Open an issue on `cloudwarriors-ai/.github` with the `autopilot` label
- Include: the runner workflow run URL, your `.autopilot/config.json`, the `AUTOPILOT_FOLLOWUP` comment body if present
- For shadow-related issues: include both the source and shadow issue numbers
