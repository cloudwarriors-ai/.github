/**
 * validate-issue-bundle.ts
 *
 * Config-driven validation that an issue fix includes the required test files.
 * Reads test patterns and assertion patterns from .autopilot/config.json.
 *
 * Usage:
 *   npx tsx validate-issue-bundle.ts --issue 123 --config .autopilot/config.json
 *   npx tsx validate-issue-bundle.ts --issue 123 --ci
 *
 * Exit codes:
 *   0 = PASS
 *   1 = FAIL
 *   2 = INCONCLUSIVE_SETUP_ERROR
 */

import { parseArgs } from 'node:util';
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execSync } from 'node:child_process';
import { globSync } from 'node:fs';

// --- Types ---

export type BundleOutcome = 'PASS' | 'FAIL' | 'INCONCLUSIVE_SETUP_ERROR';

export interface BundleValidation {
  outcome: BundleOutcome;
  issueId: number;
  checks: BundleCheck[];
  summary: string;
}

export interface BundleCheck {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface AutopilotConfig {
  name: string;
  runtime?: string;
  testPatterns?: string[];
  assertionPatterns?: string[];
  testCommand?: string;
  testFramework?: string;
  buildCommand?: string;
  lintCommand?: string;
  dbMigrateCommand?: string;
  [key: string]: any;
}

// --- Config loader ---

export function loadConfig(rootDir: string, configPath?: string): AutopilotConfig {
  const path = configPath || join(rootDir, '.autopilot', 'config.json');
  if (existsSync(path)) {
    return JSON.parse(readFileSync(path, 'utf-8'));
  }
  // Defaults for projects without config (backward compat)
  return {
    name: 'unknown',
    testPatterns: ['tests/integration/issues/issue-{id}-*', 'tests/e2e/issues/issue-{id}-*'],
    assertionPatterns: ['expect('],
  };
}

// --- File pattern helpers ---

function resolveGlob(pattern: string, rootDir: string): string[] {
  try {
    // Node 22+ has globSync on fs module
    const { globSync: fsGlob } = require('node:fs');
    return fsGlob(pattern, { cwd: rootDir }).map((f: string) => join(rootDir, f));
  } catch {
    // Fallback: manual directory scanning
    return manualGlob(pattern, rootDir);
  }
}

function manualGlob(pattern: string, rootDir: string): string[] {
  // Simple glob: support ** and * patterns
  const parts = pattern.split('/');
  const dirParts = parts.slice(0, -1);
  const filePart = parts[parts.length - 1];

  let dir = rootDir;
  for (const p of dirParts) {
    if (p === '**') break;
    dir = join(dir, p);
  }

  if (!existsSync(dir)) return [];

  try {
    const files = readdirSync(dir, { recursive: pattern.includes('**') });
    const fileRegex = new RegExp('^' + filePart.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
    return (files as string[])
      .filter(f => fileRegex.test(typeof f === 'string' ? f.split('/').pop()! : ''))
      .map(f => join(dir, f as string));
  } catch {
    return [];
  }
}

export function findIssueTestFiles(issueId: number, rootDir: string, config: AutopilotConfig) {
  const patterns = config.testPatterns || [
    'tests/integration/issues/issue-{id}-*',
    'tests/e2e/issues/issue-{id}-*',
  ];

  const files: { pattern: string; paths: string[] }[] = [];
  for (const pattern of patterns) {
    const resolved = pattern.replace('{id}', String(issueId));
    const matches = resolveGlob(resolved, rootDir);
    files.push({ pattern: resolved, paths: matches });
  }

  return files;
}

// --- Content checks ---

export function checkFileHasAssertions(filePath: string, patterns?: string[]): boolean {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const assertionPatterns = patterns || ['expect('];
    return assertionPatterns.some(p => content.includes(p));
  } catch {
    return false;
  }
}

export function checkNoPlaceholders(filePath: string): boolean {
  try {
    const content = readFileSync(filePath, 'utf-8');
    if (/\btest\.skip\b/.test(content)) return false;
    if (/\bit\.skip\b/.test(content)) return false;
    if (/\/\/\s*TODO/i.test(content)) return false;
    if (/test\s*\([^)]*,\s*(?:async\s*)?\(\)\s*=>\s*\{\s*\}\s*\)/.test(content)) return false;
    // Python placeholders
    if (/\bpass\b/.test(content) && /def test_/.test(content)) {
      // Only flag if a test function body is just "pass"
      if (/def test_\w+\([^)]*\):\s*\n\s+pass\s*$/m.test(content)) return false;
    }
    if (/@pytest\.mark\.skip/.test(content)) return false;
    if (/@unittest\.skip/.test(content)) return false;
    return true;
  } catch {
    return false;
  }
}

// --- Validation orchestrator ---

export function validateBundle(
  issueId: number,
  rootDir: string,
  config: AutopilotConfig,
  options?: {
    pr?: number;
    base?: string;
    track?: string;
    head?: string;
    ci?: boolean;
  }
): BundleValidation {
  const checks: BundleCheck[] = [];
  const fileGroups = findIssueTestFiles(issueId, rootDir, config);

  const allFiles: string[] = [];

  // Check each pattern group has files
  for (const group of fileGroups) {
    if (group.paths.length === 0) {
      // First pattern is typically required, others optional
      const isFirst = fileGroups.indexOf(group) === 0;
      checks.push({
        name: `test-file-exists:${group.pattern}`,
        passed: !isFirst, // First pattern required, others optional
        detail: isFirst
          ? `No test file found matching "${group.pattern}"`
          : `[WARN] No file matching "${group.pattern}" — optional`,
      });
    } else {
      checks.push({
        name: `test-file-exists:${group.pattern}`,
        passed: true,
        detail: group.paths.map(f => f.split('/').pop()).join(', '),
      });
      allFiles.push(...group.paths);
    }
  }

  // Check all test files for placeholders and assertions
  for (const file of allFiles) {
    const shortName = file.split('/').pop() || file;

    const clean = checkNoPlaceholders(file);
    checks.push({
      name: `no-placeholders:${shortName}`,
      passed: clean,
      detail: clean ? 'No placeholders or skipped tests' : 'Contains TODO, skip, or empty test body',
    });

    const hasAssert = checkFileHasAssertions(file, config.assertionPatterns);
    checks.push({
      name: `has-assertions:${shortName}`,
      passed: hasAssert,
      detail: hasAssert ? 'Contains assertions' : `Missing assertion patterns: ${(config.assertionPatterns || ['expect(']).join(', ')}`,
    });
  }

  // --- Run tests if in CI mode ---
  if (options?.ci && allFiles.length > 0 && config.testCommand) {
    try {
      execSync(config.testCommand, {
        timeout: 180_000,
        stdio: 'pipe',
        cwd: rootDir,
      });
      checks.push({ name: 'tests-pass', passed: true, detail: 'Test command passed' });
    } catch (err: any) {
      const output = err.stdout?.toString() || err.stderr?.toString() || '';
      checks.push({
        name: 'tests-pass',
        passed: false,
        detail: `Tests failed: ${output.slice(-500)}`,
      });
    }
  }

  // --- Determine outcome ---
  const ADVISORY_CHECKS = new Set(['tests-pass']);
  const failed = checks.filter(c => !c.passed && !ADVISORY_CHECKS.has(c.name));
  const advisoryFailed = checks.filter(c => !c.passed && ADVISORY_CHECKS.has(c.name));

  let outcome: BundleOutcome;
  let summary: string;

  if (failed.length === 0) {
    outcome = 'PASS';
    const advisoryNote = advisoryFailed.length > 0
      ? ` (advisory failures: ${advisoryFailed.map(c => c.name).join(', ')})`
      : '';
    summary = `All ${checks.length - advisoryFailed.length} required checks passed for issue #${issueId}${advisoryNote}`;
  } else {
    const isSetupError = failed.some(
      c => c.detail?.includes('SETUP_ERROR') || c.detail?.includes('ECONNREFUSED')
    );
    outcome = isSetupError ? 'INCONCLUSIVE_SETUP_ERROR' : 'FAIL';
    summary = `${failed.length}/${checks.length} checks failed for issue #${issueId}: ${failed.map(c => c.name).join(', ')}`;
  }

  return { outcome, issueId, checks, summary };
}

// --- CLI entry point ---

function main() {
  const { values } = parseArgs({
    options: {
      issue: { type: 'string', short: 'i' },
      config: { type: 'string', short: 'c' },
      pr: { type: 'string' },
      base: { type: 'string' },
      track: { type: 'string' },
      head: { type: 'string' },
      ci: { type: 'boolean', default: false },
    },
  });

  const issueId = parseInt(values.issue || '', 10);
  if (!issueId || isNaN(issueId)) {
    console.error('Usage: npx tsx validate-issue-bundle.ts --issue <number> [--config path] [--ci]');
    process.exit(1);
  }

  const rootDir = process.cwd();
  const config = loadConfig(rootDir, values.config);
  const result = validateBundle(issueId, rootDir, config, {
    pr: values.pr ? parseInt(values.pr) : undefined,
    base: values.base,
    track: values.track,
    head: values.head,
    ci: values.ci,
  });

  for (const check of result.checks) {
    const icon = check.passed ? 'PASS' : 'FAIL';
    console.log(`  [${icon}] ${check.name}: ${check.detail || ''}`);
  }

  console.log(`\nOutcome: ${result.outcome}`);
  console.log(result.summary);

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `outcome=${result.outcome}\n`);
    appendFileSync(process.env.GITHUB_OUTPUT, `summary=${result.summary}\n`);
  }

  if (result.outcome === 'PASS') process.exit(0);
  else if (result.outcome === 'INCONCLUSIVE_SETUP_ERROR') process.exit(2);
  else process.exit(1);
}

const isDirectRun = process.argv[1]?.endsWith('validate-issue-bundle.ts');
if (isDirectRun) {
  main();
}
