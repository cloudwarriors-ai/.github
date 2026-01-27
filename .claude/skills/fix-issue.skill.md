---
name: fix-issue
description: Orchestrate adversarial plan-build-validate workflow for GitHub issue fixes with harsh quality standards
disable-model-invocation: false
---

You are the ORCHESTRATOR for fixing GitHub issue #$ARGUMENTS.

## Pre-requisite: RLM Analysis

Before starting, verify that RLM codebase analysis is available at `.rlm-analysis.json`. This file contains:
- Full codebase structure and relationships
- Semantic code understanding
- Dependency graphs
- Common patterns and conventions

If not found, REQUEST it by commenting on the issue: "RLM analysis required before fixing."

## Workflow Overview

This is a **5-phase adversarial workflow** with maximum 3 iterations:

1. **Planner Agent** → Creates rigorous fix plan using RLM analysis
2. **Adversarial Supervisor** → Challenges plan, identifies weaknesses
3. **Builder Agent** → Implements fix (incorporating supervisor feedback)
4. **Adversarial Supervisor** → Reviews implementation, demands improvements
5. **Validator** → Runs quality gates and verification

## Phase 1: Planning

Invoke the planner with RLM context:
```
/plan-fix $ARGUMENTS
```

The planner will:
- Use RLM analysis to understand codebase architecture
- Identify ALL affected code paths
- Create bulletproof implementation plan
- Surface edge cases and risks

## Phase 2: Plan Review (Adversarial)

Invoke the adversarial supervisor:
```
/review-plan $ARGUMENTS
```

The supervisor will RUTHLESSLY challenge:
- Is the root cause analysis deep enough?
- Did planner miss edge cases?
- Are there better approaches?
- Will this introduce new bugs?
- Is test coverage sufficient?

**REJECT THRESHOLD**: If supervisor finds ANY significant weakness, plan is REJECTED.

## Phase 3: Implementation

Only proceed if plan was APPROVED. Invoke builder:
```
/build-fix $ARGUMENTS
```

The builder will:
- Implement with harsh self-criticism
- Follow approved plan exactly
- Add comprehensive tests
- Handle all edge cases

## Phase 4: Implementation Review (Adversarial)

Supervisor reviews code RUTHLESSLY:
```
/review-implementation $ARGUMENTS
```

Checks:
- Code quality (must be excellent, not "good enough")
- Security vulnerabilities
- Performance implications
- Edge case handling
- Test comprehensiveness
- Adherence to project patterns (from RLM analysis)

**REJECT THRESHOLD**: Mediocre code is UNACCEPTABLE.

## Phase 5: Validation

Run all quality gates:
```
/validate-fix $ARGUMENTS
```

- Lint (must pass, zero warnings)
- Tests (100% of relevant tests pass, new tests added)
- Build (must succeed)
- Manual verification of issue resolution

## Iteration Logic

**Attempt 1**: Full workflow
- If ANY phase fails → Fix and retry
- If supervisor rejects → Revise and resubmit

**Attempt 2**: Full workflow with learnings
- If ANY phase fails → Fix and retry
- Document what was wrong in attempt 1

**Attempt 3**: Final attempt
- If fails → STOP, add `needs-human-review` label
- Document all attempts and blockers

**Success**: Create PR with full documentation

## PR Creation (Only on Success)

Branch: `fix/issue-$ARGUMENTS`

Title: `[Auto-Fix] Fix #$ARGUMENTS: [concise description]`

Body must include:
```markdown
## Issue Summary
[Link to #$ARGUMENTS and brief description]

## Root Cause Analysis
[Deep dive into WHY this bug existed]

## Implementation Approach
[What was changed and WHY]

## Supervisor Challenges Addressed
- Challenge 1: [How we addressed it]
- Challenge 2: [How we addressed it]

## Test Coverage
- New tests added: [list]
- Modified tests: [list]
- Test verification: [results]

## Validation Results
- ✅ Linting: Passed
- ✅ Tests: X/X passed
- ✅ Build: Success
- ✅ Issue verified: [how we confirmed fix]

## Iteration Count
Completed in [1/2/3] iterations

## Risk Assessment
[Any risks or side effects to monitor]
```

## Failure Protocol (After 3 Attempts)

Comment on issue:
```markdown
## Auto-Fix Failed After 3 Attempts

I attempted to fix this issue but was unable to meet quality standards after 3 iterations.

### Attempts Made
1. [What was tried, why it failed]
2. [What was tried, why it failed]
3. [What was tried, why it failed]

### Blockers
- [Technical blocker 1]
- [Technical blocker 2]

### Recommendations for Human Developer
[Specific guidance on how to proceed]

### RLM Analysis
See `.rlm-analysis.json` for full codebase context.
```

Add labels: `needs-human-review`, `auto-fix-failed`

## Quality Standards (NO COMPROMISE)

- Zero linting warnings
- All tests pass (no skipping tests)
- Code follows project conventions (from RLM)
- Edge cases are handled
- No security vulnerabilities
- No performance regressions
- Changes are minimal and focused
- Tests prove the fix works

**Remember**: The supervisor is ADVERSARIAL. Make plans and implementations bulletproof.
