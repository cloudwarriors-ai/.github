# Quick Setup: Claude Auto-Fix for Any Repo

Enable adversarial Claude auto-fix in **any CloudWarriors AI repository** with just 1 file.

---

## ⚡ 30-Second Setup

### Option 1: Use Workflow Template (Easiest)

1. Go to your repository on GitHub
2. Click **Actions** tab
3. Search for **"Claude Auto-Fix with RLM"**
4. Click **Configure**
5. Commit the file
6. **Done!** Comment `@claude` on any issue to trigger auto-fix

### Option 2: Manual Setup (Copy-Paste)

Create `.github/workflows/claude-autofix.yml` in your repo:

```yaml
name: Claude Auto-Fix

on:
  issue_comment:
    types: [created]

jobs:
  trigger-autofix:
    if: |
      !github.event.issue.pull_request &&
      contains(github.event.comment.body, '@claude')
    uses: cloudwarriors-ai/.github/.github/workflows/reusable-claude-autofix-rlm.yml@main
    with:
      issue_number: ${{ github.event.issue.number }}
    secrets: inherit
```

Commit and push. **Done!**

### Option 3: One-Line Setup (Copy-Paste)

Run this in your repo root:

```bash
mkdir -p .github/workflows && curl -o .github/workflows/claude-autofix.yml https://raw.githubusercontent.com/cloudwarriors-ai/.github/main/workflow-templates/claude-autofix.yml && git add .github/workflows/claude-autofix.yml && git commit -m "feat: enable Claude auto-fix" && git push
```

**Done!**

---

## 🎯 Usage

Comment on any issue:
```
@claude
```

That's it! Claude will:
1. 🔍 Run RLM analysis on entire codebase
2. 📝 Create bulletproof fix plan
3. 🔎 Challenge plan adversarially
4. 🛠️ Implement with excellence
5. 🔎 Review code ruthlessly
6. ✅ Run all quality gates
7. 📤 Create PR (or escalate to human)

---

## ⚙️ Customization (Optional)

Want to customize? Add these inputs:

```yaml
jobs:
  trigger-autofix:
    uses: cloudwarriors-ai/.github/.github/workflows/reusable-claude-autofix-rlm.yml@main
    with:
      issue_number: ${{ github.event.issue.number }}
      max_rlm_cost: 10          # Increase RLM budget (default: 5)
      max_claude_turns: 50      # More attempts (default: 30)
      claude_model: 'claude-opus-4-5-20251101'  # Different model
    secrets: inherit
```

---

## 🔐 Prerequisites

Organization secrets (already set):
- ✅ `ANTHROPIC_API_KEY`
- ✅ `OPENROUTER_API_KEY`

No per-repo setup needed!

---

## 📊 What Gets Created

When triggered, the workflow:
- Runs RLM analysis (~30 sec, $0.50-$5)
- Creates `.rlm-analysis.json` (temporary)
- Uses adversarial skills from org repo (automatic)
- Uses `CLAUDE.md` standards from org repo (automatic)
- Creates branch `fix/issue-<number>`
- Creates PR with comprehensive documentation

---

## 🎨 How It Works

```
Your Repo                  Org .github Repo
    │                            │
    │  @claude comment           │
    │──────────────────────────> │
    │                            │
    │  Calls reusable workflow   │
    │<─────────────────────────> │
    │                            │
    │  Fetches skills & CLAUDE.md│
    │<─────────────────────────  │
    │                            │
    │  Runs RLM analysis         │
    │  Runs adversarial workflow │
    │  Creates PR                │
    │                            │
```

The heavy lifting is in the org repo. Your repo just needs the 9-line trigger.

---

## 🚀 Advanced: Multi-Repo Setup Script

Want to enable in multiple repos at once?

```bash
#!/bin/bash
# enable-claude-autofix.sh

REPOS=(
  "repo1"
  "repo2"
  "repo3"
)

for repo in "${REPOS[@]}"; do
  echo "Setting up $repo..."
  cd "$repo"

  mkdir -p .github/workflows
  curl -o .github/workflows/claude-autofix.yml \
    https://raw.githubusercontent.com/cloudwarriors-ai/.github/main/workflow-templates/claude-autofix.yml

  git add .github/workflows/claude-autofix.yml
  git commit -m "feat: enable Claude auto-fix"
  git push

  cd ..
  echo "✅ $repo setup complete"
done

echo "🎉 All repos configured!"
```

---

## 📚 Full Documentation

For deep dive, see:
- [Adversarial Workflow Setup](./ADVERSARIAL_WORKFLOW_SETUP.md)
- [CLAUDE.md Standards](./CLAUDE.md)
- [Skills Documentation](./.claude/skills/)

---

## ❓ Troubleshooting

**"Workflow not found"**
- Make sure you're in a CloudWarriors AI organization repo
- Check that the org secrets are set

**"Lock label stuck"**
```bash
gh issue edit <issue-number> --remove-label "claude-working"
```

**"RLM analysis failed"**
- Check `OPENROUTER_API_KEY` is set in org secrets
- Verify API key has credits

---

## 🎯 That's It!

Nine lines of YAML gives you:
- ✅ Adversarial quality assurance
- ✅ RLM codebase intelligence
- ✅ Clean code enforcement
- ✅ Automatic retries
- ✅ Human escalation

Questions? Open an issue at `cloudwarriors-ai/.github`
