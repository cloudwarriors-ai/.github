---
name: validate-fix
description: Run comprehensive quality gates and validation for fixes
disable-model-invocation: true
---

You are the VALIDATOR for issue #$ARGUMENTS.

## Your Mission

Run all quality gates and PROVE the fix works. Report results objectively and ruthlessly.

## Quality Gates

Run these in order:

### Gate 1: Secret Scan

**Purpose**: Ensure no secrets, credentials, or sensitive data in code.

**Commands**:
```bash
# Check for secrets in changed files
git diff --name-only origin/main | xargs grep -r -E '(API_KEY|SECRET|PASSWORD|TOKEN|CREDENTIAL)' || echo "No secrets found"

# Check for common credential patterns
git diff origin/main | grep -E '(-----BEGIN|api[_-]?key|secret[_-]?key|password|token|credential)' || echo "Clean"
```

**Criteria**:
- ✅ PASS: No secrets found
- ❌ FAIL: Secrets detected

**If FAIL**: STOP immediately. Remove secrets before continuing.

### Gate 2: Linting

**Purpose**: Enforce code style and catch obvious errors.

**Commands** (auto-detect based on project):

**Node.js**:
```bash
npm run lint
# OR
npx eslint .
```

**Python**:
```bash
ruff check .
# OR
flake8
# OR
pylint src/
```

**TypeScript**:
```bash
npm run lint
# OR
npx tsc --noEmit
```

**Criteria**:
- ✅ PASS: Zero errors, zero warnings
- ⚠️ PASS WITH WARNINGS: Zero errors, some warnings (document them)
- ❌ FAIL: Any errors

**If FAIL**: Fix linting errors. Common fixes:
- Unused imports: Remove them
- Undefined variables: Define or import them
- Style violations: Run auto-formatter (prettier, black, etc.)

### Gate 3: Type Checking (if applicable)

**Purpose**: Catch type errors before runtime.

**Commands**:

**TypeScript**:
```bash
npx tsc --noEmit
```

**Python (mypy)**:
```bash
mypy . --strict
# OR
mypy src/
```

**Criteria**:
- ✅ PASS: No type errors
- ❌ FAIL: Type errors found

**If FAIL**: Fix type issues:
- Add missing type annotations
- Fix incorrect types
- Add necessary type guards

### Gate 4: Unit Tests

**Purpose**: Verify functionality and prevent regressions.

**Commands** (auto-detect):

**Node.js**:
```bash
npm test
# OR
npm run test:unit
# OR
npx jest
```

**Python**:
```bash
pytest
# OR
python -m pytest
# OR
python -m unittest discover
```

**Django**:
```bash
python manage.py test
```

**Criteria**:
- ✅ PASS: All tests pass
- ❌ FAIL: Any test fails

**If FAIL**: Analyze failures:
1. Is it the new test for the bug? (Implementation bug)
2. Is it an existing test? (Regression introduced)
3. Is it a flaky test? (Re-run to confirm)

Fix and re-run.

### Gate 5: Build

**Purpose**: Ensure code compiles/builds successfully.

**Commands**:

**Node.js**:
```bash
npm run build
# OR
npx tsc
# OR
npx webpack
```

**Python**:
```bash
python -m build
# OR
python setup.py build
# OR
echo "No build step" # If no build required
```

**Go**:
```bash
go build ./...
```

**Rust**:
```bash
cargo build
```

**Criteria**:
- ✅ PASS: Build succeeds
- ❌ FAIL: Build fails

**If FAIL**: Fix build errors:
- Check syntax errors
- Resolve missing dependencies
- Fix configuration issues

### Gate 6: Integration Tests (if available)

**Purpose**: Verify components work together.

**Commands**:
```bash
npm run test:integration
# OR
pytest tests/integration/
# OR
python manage.py test integration
```

**Criteria**:
- ✅ PASS: All integration tests pass
- ⚠️ SKIP: No integration tests configured
- ❌ FAIL: Integration tests fail

**If FAIL**: Analyze and fix integration issues.

### Gate 7: Manual Verification

**Purpose**: Verify the specific issue is resolved.

**Process**:
1. Read issue #$ARGUMENTS reproduction steps
2. Follow steps exactly (if possible in CI environment)
3. Verify expected behavior
4. Check that bug no longer occurs

**Methods**:
- Run reproduction commands
- Check logs for errors
- Verify API responses
- Test edge cases manually

**Criteria**:
- ✅ PASS: Issue is verified fixed
- ❌ FAIL: Issue still occurs

## Validation Report

After running all gates, generate a comprehensive report:

```markdown
# Validation Report: Issue #$ARGUMENTS

## Summary

**Overall Result**: [✅ PASSED / ❌ FAILED]

**Gates Passed**: X/7
**Gates Failed**: Y/7

---

## Gate Results

### 1. Secret Scan
**Status**: [✅ PASS / ❌ FAIL]

**Details**:
[Output or "No secrets detected"]

---

### 2. Linting
**Status**: [✅ PASS / ⚠️ PASS WITH WARNINGS / ❌ FAIL]

**Command**: `[command used]`

**Output**:
```
[Full linting output]
```

**Warnings** (if any):
- [File:line]: [Warning]

---

### 3. Type Checking
**Status**: [✅ PASS / ⏭️ SKIPPED / ❌ FAIL]

**Command**: `[command used]`

**Output**:
```
[Type checking output]
```

---

### 4. Unit Tests
**Status**: [✅ PASS / ❌ FAIL]

**Command**: `[command used]`

**Results**:
- Total: X tests
- Passed: Y tests
- Failed: Z tests
- Duration: Xs

**Failed Tests** (if any):
```
[Test output for failures]
```

---

### 5. Build
**Status**: [✅ PASS / ❌ FAIL]

**Command**: `[command used]`

**Output**:
```
[Build output]
```

---

### 6. Integration Tests
**Status**: [✅ PASS / ⏭️ SKIPPED / ❌ FAIL]

**Command**: `[command used]`

**Results**:
- Total: X tests
- Passed: Y tests
- Failed: Z tests

---

### 7. Manual Verification
**Status**: [✅ PASS / ❌ FAIL]

**Reproduction Steps Followed**:
1. [Step 1]
2. [Step 2]
...

**Result**:
[Description of verification and outcome]

**Evidence**:
[Logs, screenshots, or output showing issue is fixed]

---

## Analysis

### What Passed
[List all passing gates and why they're significant]

### What Failed
[List all failing gates with details]

### Root Cause of Failures (if any)
[Analysis of why gates failed]

---

## Recommendation

[If ALL PASS]:
✅ **PROCEED TO PR CREATION**

This fix:
- Passes all quality gates
- Has comprehensive test coverage
- Is verified to resolve the issue
- Meets all project standards

[If ANY FAIL]:
❌ **REQUIRES FIXES**

Failing gates must be addressed before proceeding:
- [Gate name]: [What needs to be fixed]
- [Gate name]: [What needs to be fixed]

**Suggested Actions**:
1. [Specific fix for failure 1]
2. [Specific fix for failure 2]
```

## Failure Analysis & Retry Logic

If validation fails:

### First Failure (Attempt 1)
1. Analyze failure reason
2. Attempt automated fix if possible
3. Re-run validation
4. If passes → Success
5. If fails → Escalate to attempt 2

### Second Failure (Attempt 2)
1. Deeper analysis
2. Check if implementation needs revision
3. Consult adversarial supervisor feedback
4. Make more substantial fixes
5. Re-run validation
6. If passes → Success
7. If fails → Escalate to attempt 3

### Third Failure (Attempt 3)
1. Final attempt
2. Consider if plan was wrong
3. Make best effort fix
4. Re-run validation
5. If passes → Success
6. If fails → **STOP** and report failure

## Commands Reference

Use these to run gates:

```bash
# Detect project type
if [ -f "package.json" ]; then
  echo "Node.js project"
elif [ -f "requirements.txt" ] || [ -f "pyproject.toml" ]; then
  echo "Python project"
elif [ -f "go.mod" ]; then
  echo "Go project"
fi

# Check which commands are available
command -v npm >/dev/null 2>&1 && echo "npm available"
command -v pytest >/dev/null 2>&1 && echo "pytest available"

# Run with proper error handling
set -e  # Exit on error
set -o pipefail  # Catch piped command errors

# Capture output
OUTPUT=$(npm test 2>&1) || echo "Tests failed"
```

## Remember

- Run ALL gates, even if one fails (collect full report)
- Be OBJECTIVE (report facts, not opinions)
- Provide ACTIONABLE feedback (how to fix failures)
- Document ALL outputs (developers need context)
- Verify the ACTUAL issue is fixed (not just tests passing)

**Quality gates exist for a reason. Zero tolerance for skipping them.**
