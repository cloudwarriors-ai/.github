# cloudwarriors-ai/.github

Central resource for organization-wide development workflows, templates, and automation.

---

## Autopilot Pipeline

Fully automated issue-to-PR pipeline. Label an issue, get a tested fix with preview deployment.

### How It Works

```
Label issue "AUTOFIX: Ready"
    |
    v
[Intake] -- resolve track, base/head branches, kill switch checks
    |
    v
[RLM Fix] -- codebase analysis (10M+ tokens) --> Claude generates fix --> lint/build gates
    |
    v
[Validate] -- verify fix includes tests, no placeholders, has assertions
    |
    v
[Preflight] -- run project-specific preflight (migrations, deps, build)
    |
    v
[Deploy Preview] -- SSH to VPS, spin up isolated Docker containers per issue
    |
    v
[Test] -- run project test suite against preview
    |
    v
[Finalize] -- create/update PR, set labels, optional auto-merge
```

### Reusable Workflows

| Workflow | Purpose |
|----------|---------|
| `reusable-autopilot-intake.yml` | Kill switch, rate limiting, context resolution, dispatches runner |
| `reusable-autopilot-runner.yml` | Full pipeline: RLM fix, validate, preflight, preview deploy, test, finalize PR |
| `reusable-autopilot-cleanup.yml` | Cron: delete stale autopilot branches and orphaned preview containers |
| `reusable-autopilot-report.yml` | Weekly metrics: success rate, PRs merged, pipeline health |

### Shared Scripts (`scripts/autopilot/`)

| Script | Purpose |
|--------|---------|
| `resolve-issue-context.ts` | Detect track (bug/feature), resolve base branch, build head branch name |
| `validate-issue-bundle.ts` | Config-driven test file validation with assertion and placeholder checks |
| `preflight-ci.ts` | DB migration, health endpoint, and env var checks |
| `matrix.ts` | Collects step results into structured JSON for artifacts and PR comments |
| `smoke-suite.ts` | Resolves which smoke specs are safe for local CI execution |

### Adopting the Autopilot (New Repo Setup)

**1. Add project config** — `.autopilot/config.json`:

```json
{
  "name": "my-project",
  "runtime": "node",
  "buildCommand": "npm run build",
  "lintCommand": "npm run lint",
  "testCommand": "npm test",
  "dbMigrateCommand": "npx prisma migrate deploy",
  "testPatterns": ["tests/**/*.spec.ts"],
  "assertionPatterns": ["expect("],
  "healthEndpoint": "/api/health",
  "previewDeploy": true,
  "mergeRequirements": {
    "requireE2EPass": true,
    "requirePreviewDeploy": true,
    "autoMerge": false
  }
}
```

**2. Add thin caller workflows** — `.github/workflows/autopilot-intake.yml`:

```yaml
name: "Autopilot: Intake"
on:
  issues:
    types: [labeled]
  issue_comment:
    types: [created]
  workflow_dispatch:
    inputs:
      issue_number:
        description: 'Issue number to process'
        required: true
        type: number

jobs:
  intake:
    if: |
      (github.event_name == 'issues' &&
       github.event.action == 'labeled' &&
       github.event.label.name == 'AUTOFIX: Ready') ||
      (github.event_name == 'issue_comment' &&
       !github.event.issue.pull_request &&
       contains(github.event.comment.body, '/autofix')) ||
      github.event_name == 'workflow_dispatch'
    uses: cloudwarriors-ai/.github/.github/workflows/reusable-autopilot-intake.yml@main
    with:
      issue_number: ${{ github.event_name == 'workflow_dispatch' && github.event.inputs.issue_number || github.event.issue.number }}
    secrets: inherit
```

A workflow template is also available at `workflow-templates/autopilot-caller.yml`.

**3. Add runner workflow** — `.github/workflows/autopilot-runner.yml`:

```yaml
name: "Autopilot: Runner"
on:
  workflow_dispatch:
    inputs:
      issue_number: { required: true, type: string }
      issue_title: { required: false, type: string, default: '' }
      base: { required: true, type: string }
      head: { required: true, type: string }
      track: { required: true, type: string }

jobs:
  run:
    uses: cloudwarriors-ai/.github/.github/workflows/reusable-autopilot-runner.yml@main
    with:
      issue_number: ${{ inputs.issue_number }}
      issue_title: ${{ inputs.issue_title }}
      base: ${{ inputs.base }}
      head: ${{ inputs.head }}
      track: ${{ inputs.track }}
    secrets: inherit
```

**4. (Optional) Add preview infrastructure:**

| File | Purpose |
|------|---------|
| `scripts/preview-deploy.sh` | Deploy isolated Docker containers per issue |
| `scripts/preview-teardown.sh` | Clean up containers and worktrees |
| `docker-compose.preview.yml` | Preview-specific compose with Traefik labels |
| `.autopilot/preflight.sh` | Project-specific preflight (migrations, deps) |
| `.autopilot/seed-preview.sh` | Preview DB seeding |
| `.autopilot/claude-prompt.md` | Project-specific Claude instructions (fed to RLM) |

**5. Set up GitHub Environments** (`dev` and `production`):

| Name | Type | Description |
|------|------|-------------|
| `DEPLOY_ENABLED` | Variable | Kill switch per environment (`true`/`false`) |
| `VPS_REPO_PATH` | Variable | Repo path on VPS (e.g. `/root/web/my-project`) |
| `SSH_HOST` | Secret | VPS IP address |
| `SSH_USER` | Secret | VPS SSH user |
| `SSH_PRIVATE_KEY` | Secret | VPS SSH private key |
| `TEST_USER_EMAIL` | Secret | Test credentials for E2E |
| `TEST_USER_PASSWORD` | Secret | Test credentials for E2E |

### Safety Controls

- **Kill switches** — `AUTOPILOT: Disabled` label (global), `AUTOPILOT: Skip` label (per-issue), `DEPLOY_ENABLED=false` (per-environment)
- **Rate limiting** — Max 5 concurrent autopilot runs per repo
- **Concurrency groups** — One intake and one runner per issue, no overlapping runs
- **Auto-merge off by default** — `mergeRequirements.autoMerge: false` in config
- **Script injection hardened** — All user-controlled inputs (issue titles, labels) routed through `env:` vars, never interpolated in shell or JS

### Triggering

| Method | How |
|--------|-----|
| Label | Add `AUTOFIX: Ready` to any issue |
| Comment | Type `/autofix` on any issue |
| Manual | Dispatch `autopilot-intake.yml` with an issue number |

---

## 🚀 Our Standard Development Workflow

To ensure code quality and a smooth deployment process, all code changes must follow this workflow.

**1. Get a Task ✅**
   - All work must originate from an issue in github. This ensures every change has a clear purpose and is tracked.

**2. Create a Branch 🌿**
   - Never commit directly to `main` or `develop`.
   - Create your branch from the latest version of the `develop` branch.
   - **Branch Naming Convention:** `[type]/[ticket-number]-[short-description]`
   - **Examples:**
     - `feature/PROJ-123-add-user-login`
     - `bugfix/PROJ-456-fix-api-crash`

**3. Commit Your Work 💾**
   - Make small, logical commits with clear messages.
   - **Commit Message Format:** Start with a type (`feat`, `fix`, `docs`, `chore`), followed by a concise description.
   - **Example:** `feat: Add email validation to the signup form`

**4. Open a Pull Request (PR) 📬**
   - When your code is ready for review, open a Pull Request to merge your branch into `develop`.
   - **Use the PR Template:** The description will be pre-filled with our template. Please fill it out completely to give reviewers the context they need. A good description is essential for a fast review.

**5. Code Review & Merge 🔄**
   - At least one other developer must review and approve your PR.
   - Once approved and all automated checks have passed, your PR will be merged.

**6. Prepare for Deployment 🚢**
   - Merged features are bundled into releases.
   - To request a deployment, a tech lead will open a **"CAB Change Request"** issue using the provided template. This is our formal process for getting deployment approval.

---

## 🤖 Claude Auto-Fix - Adversarial Quality Assurance

### ⚡ NEW: Adversarial Auto-Fix with RLM (Recommended)

Zero tolerance for mediocrity. Adversarial agents ensure only excellent code passes.

**✅ 30-Second Setup:** [QUICK_SETUP.md](./QUICK_SETUP.md)

Just add 9 lines to `.github/workflows/claude-autofix.yml` and comment `@claude` on any issue!

**Features:**
- 🔍 **RLM Analysis** - Full codebase intelligence (10M+ tokens)
- 🎯 **Adversarial Agents** - Planner, Supervisor, Builder, Validator
- 📋 **Clean Code Enforcement** - SRP, DRY, separation of concerns, modularity
- 🔄 **Auto-Retry** - Up to 3 attempts to get it right
- 🚀 **Question Escalation** - Agent → Supervisor → Orchestrator → Human

**[Read Full Documentation →](./ADVERSARIAL_WORKFLOW_SETUP.md)**

---

## 🤖 Claude CI - Legacy Workflows

This repository also provides the original Claude CI workflows:

### Available Workflows

| Workflow | Description | Trigger | Status |
|----------|-------------|---------|--------|
| `reusable-autopilot-intake.yml` | Autopilot intake: kill switch, context resolution, dispatch | `AUTOFIX: Ready` label / `/autofix` comment | Active |
| `reusable-autopilot-runner.yml` | Autopilot runner: RLM fix, validate, preview, test, PR | Dispatched by intake | Active |
| `reusable-autopilot-cleanup.yml` | Cleanup stale branches and orphaned preview containers | Cron / manual | Active |
| `reusable-autopilot-report.yml` | Weekly autopilot metrics report | Cron / manual | Active |
| `reusable-claude-autofix-rlm.yml` | Adversarial auto-fix with RLM (fix engine for autopilot) | See [Quick Setup](./QUICK_SETUP.md) | Active |
| `reusable-claude-issue-handler.yml` | Basic issue fixing | `@claude` comment on issue | Legacy |
| `reusable-claude-pr-review.yml` | PR reviews | `@claude review` comment or label | Legacy |
| `reusable-quality-gates.yml` | Lint, test, build checks | Called by other workflows | Active |
| `reusable-secret-scan.yml` | Secret scanning | Called by other workflows | Active |
| `reusable-claude-runner.yml` | Generic Claude wrapper | Called by other workflows | Active |

### Quick Start (Legacy)

Add this workflow file to your repo at `.github/workflows/claude-ci.yml`:

```yaml
name: Claude CI

on:
  issue_comment:
    types: [created]
  pull_request:
    types: [labeled]
  workflow_dispatch:
    inputs:
      pr_number:
        description: 'PR number to review'
        required: true
        type: number

jobs:
  # Fix issues when someone comments "@claude"
  handle-issue:
    if: |
      github.event_name == 'issue_comment' &&
      !github.event.issue.pull_request &&
      contains(github.event.comment.body, '@claude')
    uses: cloudwarriors-ai/.github/.github/workflows/reusable-claude-issue-handler.yml@main
    with:
      target_branch: main
    secrets: inherit

  # Review PRs when someone comments "@claude review"
  review-pr-on-comment:
    if: |
      github.event_name == 'issue_comment' &&
      github.event.issue.pull_request &&
      contains(github.event.comment.body, '@claude') &&
      contains(github.event.comment.body, 'review')
    uses: cloudwarriors-ai/.github/.github/workflows/reusable-claude-pr-review.yml@main
    secrets: inherit

  # Review PRs when "claude-review" label is added
  review-pr-on-label:
    if: |
      github.event_name == 'pull_request' &&
      github.event.action == 'labeled' &&
      github.event.label.name == 'claude-review'
    uses: cloudwarriors-ai/.github/.github/workflows/reusable-claude-pr-review.yml@main
    secrets: inherit
```

### Usage

**Fix an Issue:**
1. Create an issue with clear description and acceptance criteria
2. Comment `@claude` on the issue
3. Claude will create a PR with the fix

**Review a PR:**
- Comment `@claude review` on the PR, OR
- Add the `claude-review` label to the PR

**Command Options (in comments):**
- `@claude [target:develop]` - Target a specific branch
- `@claude [hint: focus on auth logic]` - Provide guidance
- `@claude [iterations:5]` - Max fix attempts
- `@claude review [review only]` - Review without auto-fix

### Required Secrets (Org-Level)

Set these at `github.com/organizations/cloudwarriors-ai/settings/secrets/actions`:

| Secret | Used By | Description |
|--------|---------|-------------|
| `ANTHROPIC_API_KEY` | RLM, Autopilot | Claude API key |
| `OPENROUTER_API_KEY` | RLM, Autopilot | Codebase analysis via OpenRouter |
| `WORKFLOW_PAT` | Autopilot | GitHub PAT for cross-repo dispatch and branch operations |
| `BROWSERBASE_API_KEY` | E2E tests | Cloud browser testing (optional) |
| `BROWSERBASE_PROJECT_ID` | E2E tests | Browserbase project (optional) |

---

## 📝 Using Our Templates

This repository provides default templates to streamline our processes. When you create a new Pull Request or Issue in any of our repositories, you will see options to use them.

* **Pull Request Template:** Used for all code changes.
* **Bug Report (Issue):** Used to report bugs in a structured way.
* **CAB Change Request (Issue):** The formal "fillable form" used to request a deployment to production.

---
