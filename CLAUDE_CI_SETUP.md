# Claude CI Setup Guide

This guide explains how to add automated Claude-powered issue fixing and PR reviews to any repository in the `cloudwarriors-ai` organization.

## Prerequisites

The following org-level secrets must be set at:
`https://github.com/organizations/cloudwarriors-ai/settings/secrets/actions`

| Secret | Required | Description |
|--------|----------|-------------|
| `OPENROUTER_API_KEY` | **Yes** | API key for Claude via OpenRouter |
| `BROWSERBASE_API_KEY` | No | For cloud browser verification |
| `BROWSERBASE_PROJECT_ID` | No | Browserbase project ID |

---

## Quick Setup (Copy & Paste)

### Step 1: Create the Workflow File

Create `.github/workflows/claude-ci.yml` in your repo:

```yaml
name: Claude CI

on:
  issue_comment:
    types: [created]
  pull_request:
    types: [labeled]
  repository_dispatch:
    types: [pr-review]
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
      target_branch: main  # Change to your default branch (main, master, develop, etc.)
      # -- Node.js projects (uncomment and configure):
      # node_version: '22'
      # lint_command: 'npm run lint'
      # test_command: 'npm run test:unit'
      # build_command: 'npm run build'
      # -- Python projects (uncomment and configure):
      # python_version: '3.11'
      # install_command: 'pip install -r requirements.txt'
      # lint_command: 'ruff check . && mypy .'
      # test_command: 'pytest'
      # build_command: 'echo "No build step"'
    secrets: inherit

  # Review PRs when someone comments "@claude review"
  review-pr-on-comment:
    if: |
      github.event_name == 'issue_comment' &&
      github.event.issue.pull_request &&
      contains(github.event.comment.body, '@claude') &&
      contains(github.event.comment.body, 'review')
    uses: cloudwarriors-ai/.github/.github/workflows/reusable-claude-pr-review.yml@main
    with:
      max_iterations: 3
      # Configure for your language - see handle-issue above
    secrets: inherit

  # Review PRs when "claude-review" label is added
  review-pr-on-label:
    if: |
      github.event_name == 'pull_request' &&
      github.event.action == 'labeled' &&
      github.event.label.name == 'claude-review'
    uses: cloudwarriors-ai/.github/.github/workflows/reusable-claude-pr-review.yml@main
    with:
      max_iterations: 3
      # Configure for your language - see handle-issue above
    secrets: inherit

  # Manual PR review trigger
  review-pr-manual:
    if: github.event_name == 'workflow_dispatch'
    uses: cloudwarriors-ai/.github/.github/workflows/reusable-claude-pr-review.yml@main
    with:
      max_iterations: 3
      # Configure for your language - see handle-issue above
    secrets: inherit

  # Re-review after auto-fix
  review-pr-iteration:
    if: github.event_name == 'repository_dispatch' && github.event.action == 'pr-review'
    uses: cloudwarriors-ai/.github/.github/workflows/reusable-claude-pr-review.yml@main
    with:
      max_iterations: 3
      # Configure for your language - see handle-issue above
    secrets: inherit
```

### Step 2: Customize for Your Repo

Update these values in the workflow based on your project language:

**For Node.js/TypeScript projects:**
```yaml
node_version: '22'
lint_command: 'npm run lint'
test_command: 'npm run test:unit'
build_command: 'npm run build'
```

**For Python projects:**
```yaml
python_version: '3.11'
install_command: 'pip install -r requirements.txt'
lint_command: 'ruff check . && mypy .'
test_command: 'pytest'
build_command: 'echo "No build step"'  # or 'python -m build'
```

**For Django projects:**
```yaml
python_version: '3.11'
install_command: 'pip install -r requirements.txt'
lint_command: 'ruff check . && mypy .'
test_command: 'python manage.py test'
build_command: 'python manage.py check'
```

**Common settings:**

| Setting | Default | Change To |
|---------|---------|-----------|
| `target_branch` | `main` | Your default branch (`master`, `develop`, etc.) |
| `max_iterations` | `3` | Max fix attempts before giving up |

### Step 3: Commit to Default Branch

The workflow must exist on your **default branch** to be triggered. Either:

1. Create a PR and merge it, OR
2. Push directly to main/master (if you have permission)

```bash
git add .github/workflows/claude-ci.yml
git commit -m "feat: add Claude CI workflow"
git push origin main
```

---

## Usage

### Fix an Issue Automatically

1. Create an issue with a clear description
2. Comment `@claude` on the issue
3. Claude will:
   - Analyze the issue
   - Create a fix branch
   - Implement the fix
   - Run quality gates (lint, test, build)
   - Create a PR if successful

**Options:**
```
@claude                           # Basic fix
@claude [target:develop]          # Target specific branch
@claude [hint: focus on auth]     # Provide guidance
@claude [iterations:5]            # Allow more fix attempts
```

### Review a PR

**Option A: Comment**
```
@claude review
```

**Option B: Label**
Add the `claude-review` label to the PR

**Option C: Manual Dispatch**
Go to Actions → Claude CI → Run workflow → Enter PR number

### Review Options

Add these to your comment or commit message:
```
@claude review [review only]       # Review without auto-fixing
@claude review [iterations:5]      # Allow more fix iterations
[skip automated review]            # Skip review entirely (in commit msg)
```

---

## How It Works

### Issue Fixing Flow

```
@claude comment
       │
       ▼
┌─────────────────┐
│ Analyze Issue   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Create Branch   │
│ fix/issue-{num} │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Implement Fix   │◄──────┐
└────────┬────────┘       │
         │                │
         ▼                │
┌─────────────────┐       │
│ Quality Gates   │       │
│ lint/test/build │       │
└────────┬────────┘       │
         │                │
    Pass?│                │
    ┌────┴────┐           │
    │         │           │
   Yes        No──────────┘
    │         (retry up to 5x)
    ▼
┌─────────────────┐
│   Create PR     │
└─────────────────┘
```

### PR Review Flow

```
@claude review / label added
              │
              ▼
     ┌─────────────────┐
     │  Run CI Checks  │
     │ lint/test/build │
     └────────┬────────┘
              │
              ▼
     ┌─────────────────┐
     │  Review Code    │
     │ security/quality│
     └────────┬────────┘
              │
              ▼
     ┌─────────────────┐
     │ Post Review     │
     │ Comment on PR   │
     └────────┬────────┘
              │
         Issues?
         ┌────┴────┐
         │         │
        Yes        No
         │         │
         ▼         ▼
  ┌────────────┐  ┌──────────┐
  │ Auto-Fix   │  │ Approve  │
  └─────┬──────┘  └──────────┘
        │
        ▼
  ┌────────────┐
  │ Re-trigger │◄─────┐
  │   Review   │      │
  └─────┬──────┘      │
        │             │
   Still issues?      │
        │             │
       Yes────────────┘
        │    (up to max_iterations)
       No
        │
        ▼
  ┌────────────┐
  │  Approve   │
  └────────────┘
```

---

## Workflow Inputs Reference

### Issue Handler (`reusable-claude-issue-handler.yml`)

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `target_branch` | string | `main` | Branch to base fixes on |
| `skip_browser_verification` | boolean | `true` | Skip browser tests |
| `max_retries` | number | `3` | Claude retry attempts |
| `timeout_minutes` | number | `15` | Claude execution timeout |
| **Language Setup** | | | |
| `node_version` | string | `""` | Node.js version (leave empty to skip) |
| `python_version` | string | `""` | Python version (leave empty to skip) |
| **Custom Commands** | | | |
| `setup_command` | string | `""` | Additional setup after install |
| `install_command` | string | auto | Install dependencies (auto-detects npm/pip) |
| `lint_command` | string | auto | Lint command (e.g., `npm run lint` or `ruff check .`) |
| `test_command` | string | auto | Test command (e.g., `npm run test:unit` or `pytest`) |
| `build_command` | string | auto | Build command (e.g., `npm run build`) |

### PR Review (`reusable-claude-pr-review.yml`)

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `target_branches` | string | `["main", "master"]` | Branches to review PRs for |
| `max_iterations` | number | `3` | Max review/fix cycles |
| `auto_merge_branch` | string | `""` | Branch to auto-merge approved PRs |
| `timeout_minutes` | number | `30` | Workflow timeout |
| **Language Setup** | | | |
| `node_version` | string | `""` | Node.js version (leave empty to skip) |
| `python_version` | string | `""` | Python version (leave empty to skip) |
| **Custom Commands** | | | |
| `setup_command` | string | `""` | Additional setup after install |
| `install_command` | string | auto | Install dependencies (auto-detects npm/pip) |
| `lint_command` | string | auto | Lint command |
| `test_command` | string | auto | Test command |
| `build_command` | string | auto | Build command |

### Auto-Detection Behavior

When commands are not specified, the workflow auto-detects based on project files:

| File Found | Install Command | Lint/Test/Build |
|------------|----------------|-----------------|
| `package-lock.json` | `npm ci` | `npm run lint/test:unit/build` |
| `package.json` | `npm install` | `npm run lint/test:unit/build` |
| `requirements.txt` | `pip install -r requirements.txt` | N/A (must specify) |
| `pyproject.toml` | `pip install -e .` | N/A (must specify) |
| `Pipfile` | `pipenv install --dev` | N/A (must specify) |

---

## Labels

The workflow uses these labels:

| Label | Purpose |
|-------|---------|
| `claude-review` | **Trigger** - Add to PR to start review |
| `claude-working` | Lock - Prevents concurrent runs on same issue |
| `claude-reviewed` | Status - PR has been reviewed |
| `claude-approved` | Status - PR approved by Claude |
| `needs-changes` | Status - PR needs fixes |
| `needs-human-review` | Status - Circuit breaker hit, needs manual help |

---

## Troubleshooting

### Workflow doesn't trigger

1. **Workflow not on default branch** - The `claude-ci.yml` must be merged to your default branch first
2. **Wrong trigger** - For PRs, use `@claude review` (not just `@claude`)
3. **Label doesn't exist** - Create the `claude-review` label first

### "Dependencies lock file not found" error

The repo doesn't have a `package-lock.json`. This is handled automatically - the workflow falls back to `npm install`.

### "Could not determine PR number" error

This was a bug in earlier versions. Ensure you're using the latest workflows from `cloudwarriors-ai/.github@main`.

### Claude times out

Increase `timeout_minutes` in the workflow, or add hints to narrow the scope:
```
@claude [hint: only modify the auth module]
```

### Circuit breaker triggered

After `max_iterations` fix attempts, the workflow stops and adds the `needs-human-review` label. You need to manually fix the remaining issues.

---

## Security Notes

- Claude will **never** modify `.github/workflows/` or `.env*` files
- Secrets are never exposed in logs or comments
- All changes go through secret scanning before commit
- The workflow uses `secrets: inherit` to access org-level secrets

---

## Central Repo

All reusable workflows are maintained in:
`https://github.com/cloudwarriors-ai/.github`

Updates to the central repo automatically apply to all repos using these workflows.
