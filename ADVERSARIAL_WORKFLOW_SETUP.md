# Adversarial Claude Auto-Fix Workflow Setup

This document explains how to set up the adversarial Claude auto-fix system for your CloudWarriors AI repositories.

## 📋 Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Quick Setup](#quick-setup)
- [How It Works](#how-it-works)
- [Usage](#usage)
- [Troubleshooting](#troubleshooting)

---

## Overview

The Adversarial Claude Auto-Fix workflow is a **multi-agent system** that automatically fixes GitHub issues with **brutal quality standards**. It combines:

1. **RLM Analysis** - Deep codebase understanding (10M+ token processing)
2. **Adversarial Agents** - Critical planner, builder, and supervisor agents
3. **Quality Gates** - Automated lint, test, and build validation
4. **Human Escalation** - Questions escalate through supervisor → orchestrator → human

### Key Features

✅ **Zero tolerance for mediocrity** - Only excellent code passes
✅ **RLM-powered context** - Full codebase intelligence before planning
✅ **Adversarial review** - Plans and implementations are challenged ruthlessly
✅ **Automatic retries** - Up to 3 iterations to get it right
✅ **Question escalation** - Clear path from agent → supervisor → human
✅ **Clean code enforcement** - SRP, DRY, separation of concerns, modularity

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     GitHub Issue                            │
│               Comment: "@claude"                            │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
         ┌────────────────────┐
         │  RLM Analysis      │  Analyzes entire codebase
         │  (10M+ tokens)     │  Identifies patterns, conventions
         └────────┬───────────┘
                  │
                  ▼ .rlm-analysis.json
         ┌────────────────────┐
         │  Orchestrator      │  /fix-issue skill
         │  (/fix-issue)      │
         └────────┬───────────┘
                  │
    ┌─────────────┼─────────────┐
    │             │             │
    ▼             ▼             ▼
┌────────┐  ┌──────────┐  ┌──────────┐
│ Planner│  │Supervisor│  │ Builder  │
│ Agent  │─▶│(Critical)│◀─│  Agent   │
└────────┘  └──────────┘  └──────────┘
    │             │             │
    │        Challenges &      │
    │        Approves/Rejects   │
    │             │             │
    └─────────────┼─────────────┘
                  │
                  ▼
         ┌────────────────────┐
         │    Validator       │  Runs quality gates
         │  (lint/test/build) │
         └────────┬───────────┘
                  │
         ┌────────┴────────┐
         │                 │
    Success              Failure
         │                 │
         ▼                 ▼
    ┌────────┐      ┌─────────────┐
    │   PR   │      │ Retry (3x)  │
    └────────┘      └─────────────┘
```

---

## Prerequisites

### Organization-Level Secrets

Set these at: `https://github.com/organizations/cloudwarriors-ai/settings/secrets/actions`

| Secret | Required | Description |
|--------|----------|-------------|
| `OPENROUTER_API_KEY` | **Yes** | OpenRouter API key — powers RLM analysis **and** Claude auto-fix |
| `ANTHROPIC_API_KEY` | No | Deprecated; optional, rollback to direct Anthropic billing only |

### Required Labels

Create these labels in your repository (or they'll be auto-created):

- `claude-working` - Workflow in progress (prevents concurrent runs)
- `claude-reviewed` - PR has been reviewed
- `claude-approved` - PR approved by Claude
- `needs-changes` - PR needs fixes
- `needs-human-review` - Escalated to human
- `auto-fix-failed` - All 3 attempts failed

---

## Quick Setup

### Step 1: Copy Org-Wide Files

These files should already exist in your `.github` org repository:

```
cloudwarriors-ai/.github/
├── .claude/
│   └── skills/
│       ├── fix-issue.skill.md
│       ├── plan-fix.skill.md
│       ├── review-plan.skill.md
│       ├── build-fix.skill.md
│       ├── review-implementation.skill.md
│       └── validate-fix.skill.md
├── .github/
│   └── workflows/
│       └── claude-autofix-with-rlm.yml
└── CLAUDE.md
```

### Step 2: Add to Your Repository

Copy these files to your repository:

```bash
# In your repo root
cp /path/to/.github/org-repo/CLAUDE.md ./
cp -r /path/to/.github/org-repo/.claude ./
cp /path/to/.github/org-repo/.github/workflows/claude-autofix-with-rlm.yml ./.github/workflows/
```

Or use the workflow template from the organization.

### Step 3: Commit and Push

```bash
git add .claude/ .github/workflows/claude-autofix-with-rlm.yml CLAUDE.md
git commit -m "feat: add adversarial Claude auto-fix workflow"
git push origin main
```

### Step 4: Test

Create a test issue and comment:
```
@claude
```

---

## How It Works

### Phase 1: RLM Codebase Analysis

When someone comments `@claude` on an issue:

1. **RLM scans the entire codebase** (up to 10M tokens)
2. **Identifies**:
   - Architecture patterns (layers, modules)
   - Code conventions (naming, error handling)
   - Common patterns
   - Dependency relationships
   - Quality hotspots (complex areas)
   - Security patterns
3. **Saves analysis** to `.rlm-analysis.json`
4. **Cost**: ~$0.50 - $5.00 (configurable limit)

### Phase 2: Orchestrator (`/fix-issue`)

The orchestrator invokes the full workflow:

```
/fix-issue <issue-number>
```

1. Verifies `.rlm-analysis.json` exists
2. Coordinates all agents
3. Enforces 3-iteration maximum
4. Handles failures and escalation

### Phase 3: Planner Agent (`/plan-fix`)

Creates a **bulletproof plan**:

- Reads issue thoroughly
- Uses RLM analysis for context
- Identifies root cause (not just symptoms)
- Maps all affected code paths
- Lists ALL edge cases (minimum 5)
- Designs comprehensive tests
- Assesses risks honestly

**Output**: Detailed implementation plan with file:line references

### Phase 4: Adversarial Supervisor (`/review-plan`)

**RUTHLESSLY challenges** the plan:

- Is root cause analysis deep enough?
- Did planner actually READ the code?
- Are edge cases comprehensive?
- Will tests CATCH the bug if reintroduced?
- Is risk assessment honest?

**Decisions**:
- ✅ **APPROVE** - Plan is bulletproof, proceed
- ⚠️ **REQUEST REVISION** - Plan needs specific improvements
- ❌ **REJECT** - Plan is unacceptable, start over

### Phase 5: Builder Agent (`/build-fix`)

Implements with **EXCELLENCE**:

- Follows approved plan exactly
- Handles all edge cases
- Adds comprehensive tests
- Follows clean code principles (SRP, DRY, small functions)
- Uses dependency injection
- Separates concerns properly
- Creates modular code

**Standards**: See [CLAUDE.md](./CLAUDE.md) for full requirements

### Phase 6: Adversarial Supervisor (`/review-implementation`)

**RUTHLESSLY reviews** the code:

- Does it follow the plan?
- Is code quality excellent (not "good enough")?
- Are all edge cases handled?
- Is error handling robust?
- Are there security vulnerabilities?
- Are tests comprehensive?
- Does it follow project patterns?

**Decisions**:
- ✅ **APPROVE** - Implementation is excellent, proceed
- ⚠️ **REQUEST REVISION** - Specific issues need fixing
- ❌ **REJECT** - Code quality is unacceptable

### Phase 7: Validator (`/validate-fix`)

Runs **ALL quality gates**:

1. **Secret Scan** - No credentials in code
2. **Linting** - Zero errors, zero warnings
3. **Type Checking** - No type errors (if applicable)
4. **Unit Tests** - All tests pass
5. **Build** - Build succeeds
6. **Integration Tests** - Integration tests pass (if available)
7. **Manual Verification** - Issue is actually fixed

**Pass Criteria**: ALL gates must pass

### Phase 8: PR Creation or Failure

**If ALL phases pass**:
- Create branch: `fix/issue-<number>`
- Commit changes
- Create PR with comprehensive documentation
- Link to original issue

**If any phase fails after 3 iterations**:
- Document all attempts
- Add `needs-human-review` label
- Comment on issue with findings
- Provide recommendations

---

## Usage

### Basic Usage

Comment on any issue:
```
@claude
```

Claude will:
1. Run RLM analysis
2. Create a fix plan
3. Review the plan adversarially
4. Implement the fix
5. Review the implementation adversarially
6. Validate with quality gates
7. Create a PR (if successful)

### Advanced Options

You can customize the workflow by editing your issue comment:

```
@claude [target:develop] [iterations:5] [hint: focus on authentication module]
```

**Options**:
- `[target:branch]` - Target a specific branch
- `[iterations:N]` - Allow more than 3 iterations
- `[hint:text]` - Provide guidance to the planner

### Question Escalation

If agents have questions, they follow this path:

1. **Agent** tries to answer using:
   - CLAUDE.md
   - RLM analysis
   - Existing code

2. **Supervisor** reviews question:
   - Provides guidance if possible
   - Escalates to orchestrator if needed

3. **Orchestrator** attempts resolution:
   - Uses all available tools
   - Escalates to human if necessary

4. **Human** sees comment on issue:
   ```markdown
   ## Question for Human Review

   **Context**: [What we're fixing]
   **Question**: [Specific question]
   **Options**:
   1. Option A - [Pros/Cons]
   2. Option B - [Pros/Cons]
   ```

---

## Example Workflow

### Issue: Login Button Disabled

**Comment**: `@claude`

**RLM Analysis** (30 seconds):
```
✓ Analyzed 247 files
✓ Identified React + TypeScript architecture
✓ Found authentication patterns
✓ Cost: $1.23
```

**Planner** (2 minutes):
```
Plan created:
- Root cause: State initialization race condition
- Affects: src/components/LoginForm.tsx:45
- Edge cases: 7 identified
- Tests: 4 new tests required
```

**Supervisor Challenge** (1 minute):
```
Challenge: Did you check if this affects mobile app?
Response: Yes, mobile uses same component. Fix applies.

Challenge: What about logout button? Same pattern?
Response: Good catch. Will fix both. Adding to plan.

✅ APPROVED
```

**Builder** (5 minutes):
```
Implemented:
- Fixed state initialization
- Applied to login AND logout buttons
- Added 5 tests
- All edge cases handled
```

**Supervisor Review** (2 minutes):
```
Code quality: Excellent
Edge cases: All handled
Tests: Comprehensive
Security: No issues

✅ APPROVED
```

**Validator** (1 minute):
```
✓ Secret scan: Pass
✓ Linting: Pass (0 errors, 0 warnings)
✓ Type checking: Pass
✓ Unit tests: Pass (127/127)
✓ Build: Success
✓ Manual check: Login button works

✅ ALL GATES PASSED
```

**PR Created**:
```
[Auto-Fix] Fix #123: Resolve login button disabled race condition

Completed in 1 iteration
All quality gates passed
Ready for human review
```

**Total Time**: ~12 minutes

---

## Troubleshooting

### "Another Claude workflow is already processing this issue"

**Cause**: The `claude-working` label is still on the issue from a previous run.

**Fix**: Remove the label manually:
```bash
gh issue edit <issue-number> --remove-label "claude-working"
```

### "RLM analysis failed"

**Cause**: OpenRouter API key is invalid or rate limited.

**Fix**:
1. Check `OPENROUTER_API_KEY` secret is set
2. Verify API key is valid
3. Check OpenRouter account has credits

### "Supervisor rejected plan after 3 revisions"

**Cause**: The issue is too complex or ambiguous for automated fixing.

**Fix**: This is working as intended. Review the supervisor's feedback and fix manually.

### "All quality gates passed but PR not created"

**Cause**: Missing `contents: write` permission.

**Fix**: Ensure workflow has correct permissions:
```yaml
permissions:
  contents: write
  pull-requests: write
  issues: write
```

### Cost Control

RLM analysis can be expensive for large codebases. Control costs:

```yaml
env:
  RLM_MAX_COST_USD: 2  # Stop if cost exceeds $2
```

Or limit files analyzed:
```javascript
const sourceFiles = files.slice(0, 50);  // Only 50 files
```

---

## Advanced Configuration

### Custom Analysis Prompt

Edit `.github/workflows/claude-autofix-with-rlm.yml`:

```javascript
const result = await rlm.query(
  context,
  `Your custom analysis prompt here...`
);
```

### Different Claude Model

Use a different model:
```yaml
claude_args: |
  --model claude-sonnet-4-5-20250929
```

### Stricter Quality Standards

Edit `CLAUDE.md` to add your own standards:

```markdown
## Additional Standards

- Maximum cyclomatic complexity: 10
- Test coverage minimum: 90%
- No nested ternaries
```

---

## Questions?

- **Documentation**: Check [CLAUDE.md](./CLAUDE.md)
- **Skills**: See [.claude/skills/](./.claude/skills/)
- **Issues**: https://github.com/cloudwarriors-ai/.github/issues
