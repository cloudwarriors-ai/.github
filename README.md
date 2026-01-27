This repository serves as the central resource for all developers at our organization. It contains the default guidelines, templates, and documentation that govern our development processes across all projects.

Our goal is to create a consistent, high-quality, and efficient workflow that empowers everyone to do their best work.

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
| `reusable-claude-autofix-rlm.yml` | **NEW** Adversarial auto-fix with RLM | See [Quick Setup](./QUICK_SETUP.md) | ✅ Recommended |
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

| Secret | Required | Description |
|--------|----------|-------------|
| `OPENROUTER_API_KEY` | Yes | API key for Claude via OpenRouter |
| `BROWSERBASE_API_KEY` | No | For cloud browser verification |
| `BROWSERBASE_PROJECT_ID` | No | Browserbase project ID |

---

## 📝 Using Our Templates

This repository provides default templates to streamline our processes. When you create a new Pull Request or Issue in any of our repositories, you will see options to use them.

* **Pull Request Template:** Used for all code changes.
* **Bug Report (Issue):** Used to report bugs in a structured way.
* **CAB Change Request (Issue):** The formal "fillable form" used to request a deployment to production.

---
