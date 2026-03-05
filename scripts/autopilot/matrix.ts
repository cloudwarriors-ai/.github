/**
 * matrix.ts
 *
 * Collects validation results into a structured JSON matrix for
 * workflow artifacts and PR comment summaries.
 *
 * Usage:
 *   npx tsx matrix.ts \
 *     --issue 123 \
 *     --contract-result pass \
 *     --integration-result pass \
 *     --e2e-result fail \
 *     --smoke-result pass \
 *     --attempt 2 \
 *     --model sonnet
 *
 * Writes matrix JSON to $MATRIX_OUTPUT_DIR/issue-<id>-matrix.json
 */

import { parseArgs } from 'node:util';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// --- Types ---

export interface ValidationMatrix {
  issueId: number;
  timestamp: string;
  attempt: number;
  model: string;
  results: {
    contract: StepResult;
    integration: StepResult;
    e2e: StepResult;
    smoke: StepResult;
    previewE2e: StepResult;
  };
  overall: 'PASS' | 'FAIL' | 'INCONCLUSIVE';
  summary: string;
}

export interface StepResult {
  status: 'pass' | 'fail' | 'skip' | 'error';
  detail?: string;
}

// --- Helpers ---

function parseStepResult(raw: string | undefined): StepResult {
  const normalized = (raw || 'skip').toLowerCase();
  switch (normalized) {
    case 'pass': return { status: 'pass' };
    case 'fail': return { status: 'fail' };
    case 'error': return { status: 'error' };
    default: return { status: 'skip' };
  }
}

function resolveOutputDir(): string {
  if (process.env.MATRIX_OUTPUT_DIR) return process.env.MATRIX_OUTPUT_DIR;
  if (process.env.RUNNER_TEMP) return process.env.RUNNER_TEMP;
  return join(process.cwd(), 'tests', 'results');
}

// --- Builder ---

export function buildMatrix(options: {
  issueId: number;
  contract: string;
  integration: string;
  e2e: string;
  smoke: string;
  previewE2e?: string;
  attempt?: number;
  model?: string;
}): ValidationMatrix {
  const results = {
    contract: parseStepResult(options.contract),
    integration: parseStepResult(options.integration),
    e2e: parseStepResult(options.e2e),
    smoke: parseStepResult(options.smoke),
    previewE2e: parseStepResult(options.previewE2e),
  };

  const ADVISORY_STEPS = new Set(['e2e', 'previewE2e']);
  const requiredEntries = Object.entries(results).filter(([name]) => !ADVISORY_STEPS.has(name));
  const requiredStatuses = requiredEntries.map(([, r]) => r.status);
  const hasError = requiredStatuses.includes('error');
  const hasFail = requiredStatuses.includes('fail');

  let overall: ValidationMatrix['overall'];
  if (hasError) overall = 'INCONCLUSIVE';
  else if (hasFail) overall = 'FAIL';
  else overall = 'PASS';

  const failedSteps = Object.entries(results)
    .filter(([name, r]) => (r.status === 'fail' || r.status === 'error') && !ADVISORY_STEPS.has(name))
    .map(([name]) => name);

  const summary =
    overall === 'PASS'
      ? `All validation steps passed for issue #${options.issueId}`
      : `Issue #${options.issueId}: ${failedSteps.join(', ')} ${overall === 'INCONCLUSIVE' ? 'had errors' : 'failed'}`;

  return {
    issueId: options.issueId,
    timestamp: new Date().toISOString(),
    attempt: options.attempt ?? 1,
    model: options.model ?? 'unknown',
    results,
    overall,
    summary,
  };
}

export function writeMatrix(matrix: ValidationMatrix, outputDir?: string): string {
  const dir = outputDir || resolveOutputDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `issue-${matrix.issueId}-matrix.json`);
  writeFileSync(filePath, JSON.stringify(matrix, null, 2));
  return filePath;
}

export function matrixToMarkdown(matrix: ValidationMatrix): string {
  const icon = (s: StepResult['status']) => {
    switch (s) {
      case 'pass': return 'PASS';
      case 'fail': return 'FAIL';
      case 'error': return 'ERROR';
      case 'skip': return 'SKIP';
    }
  };

  const r = matrix.results;
  return [
    `### Validation Matrix — Issue #${matrix.issueId}`,
    '',
    `| Step | Status |`,
    `|------|--------|`,
    `| Contract | ${icon(r.contract.status)} |`,
    `| Integration | ${icon(r.integration.status)} |`,
    `| E2E | ${icon(r.e2e.status)} |`,
    `| Smoke | ${icon(r.smoke.status)} |`,
    '',
    `**Overall:** ${matrix.overall}`,
    `**Attempt:** ${matrix.attempt} | **Model:** ${matrix.model}`,
    `**Time:** ${matrix.timestamp}`,
    '',
    matrix.summary,
  ].join('\n');
}

// --- CLI ---

function main() {
  const { values } = parseArgs({
    options: {
      issue: { type: 'string', short: 'i' },
      'contract-result': { type: 'string' },
      'integration-result': { type: 'string' },
      'e2e-result': { type: 'string' },
      'smoke-result': { type: 'string' },
      'preview-e2e-result': { type: 'string' },
      attempt: { type: 'string' },
      model: { type: 'string' },
    },
  });

  const issueId = parseInt(values.issue || '', 10);
  if (!issueId || isNaN(issueId)) {
    console.error('Usage: npx tsx matrix.ts --issue <number> --contract-result pass ...');
    process.exit(1);
  }

  const matrix = buildMatrix({
    issueId,
    contract: values['contract-result'] || 'skip',
    integration: values['integration-result'] || 'skip',
    e2e: values['e2e-result'] || 'skip',
    smoke: values['smoke-result'] || 'skip',
    previewE2e: values['preview-e2e-result'] || 'skip',
    attempt: values.attempt ? parseInt(values.attempt) : 1,
    model: values.model || 'unknown',
  });

  const filePath = writeMatrix(matrix);
  console.log(`Matrix written to: ${filePath}`);
  console.log('');
  console.log(matrixToMarkdown(matrix));
}

const isDirectRun = process.argv[1]?.endsWith('matrix.ts');
if (isDirectRun) {
  main();
}
