/**
 * preflight-ci.ts
 *
 * Config-driven CI environment preflight checks.
 * Reads commands from .autopilot/config.json or CLI overrides.
 *
 * Usage:
 *   npx tsx preflight-ci.ts --base-url http://127.0.0.1:8000 --mode full
 *   npx tsx preflight-ci.ts --mode setup --config .autopilot/config.json
 *   npx tsx preflight-ci.ts --mode health --base-url http://127.0.0.1:8000 --health-path /api/v1/health/
 *
 * Outputs: READY | SETUP_ERROR with details. Non-zero exit on failure.
 */

import { parseArgs } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

// --- Types ---

export type PreflightStatus = 'READY' | 'SETUP_ERROR';
export type PreflightMode = 'full' | 'setup' | 'health';

export interface PreflightResult {
  status: PreflightStatus;
  checks: CheckResult[];
  error?: string;
}

export interface CheckResult {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface PreflightConfig {
  dbMigrateCommand?: string | null;
  buildCommand?: string;
  lintCommand?: string;
  healthEndpoint?: string;
  requiredEnvVars?: string[];
}

// --- Config loader ---

function loadConfig(rootDir: string, configPath?: string): PreflightConfig {
  const path = configPath || join(rootDir, '.autopilot', 'config.json');
  if (existsSync(path)) {
    return JSON.parse(readFileSync(path, 'utf-8'));
  }
  return {};
}

// --- Helpers ---

export function normalizeMode(mode?: string): PreflightMode {
  const normalized = (mode || 'full').toLowerCase();
  if (normalized === 'full' || normalized === 'setup' || normalized === 'health') {
    return normalized;
  }
  throw new Error(`Invalid --mode "${mode}". Expected one of: full, setup, health`);
}

export function shouldRunSetup(mode: PreflightMode): boolean {
  return mode === 'full' || mode === 'setup';
}

export function shouldRunHealth(mode: PreflightMode): boolean {
  return mode === 'full' || mode === 'health';
}

// --- Individual checks ---

export function checkEnvVars(requiredVars?: string[]): CheckResult {
  const required = requiredVars || ['DATABASE_URL'];
  const missing = required.filter(v => !process.env[v]);

  if (missing.length > 0) {
    return {
      name: 'env-vars',
      passed: false,
      detail: `Missing required env vars: ${missing.join(', ')}`,
    };
  }

  return { name: 'env-vars', passed: true, detail: 'All required env vars present' };
}

export function checkDbMigration(command: string): CheckResult {
  try {
    execSync(command + ' 2>&1', {
      timeout: 60_000,
      stdio: 'pipe',
      env: process.env,
    });
    return { name: 'db-migration', passed: true, detail: `Migration command succeeded: ${command}` };
  } catch (err: any) {
    const output = err.stdout?.toString() || err.stderr?.toString() || err.message;
    return {
      name: 'db-migration',
      passed: false,
      detail: `Migration failed: ${output.slice(0, 500)}`,
    };
  }
}

export async function checkHealthEndpoint(
  baseUrl: string,
  healthPath: string = '/api/v1/health',
  maxRetries = 3,
  intervalMs = 5000
): Promise<CheckResult> {
  const url = `${baseUrl}${healthPath}`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (res.ok) {
        return { name: 'health-check', passed: true, detail: `${url} responded 200 on attempt ${attempt}` };
      }
    } catch {}

    if (attempt < maxRetries) {
      await new Promise(r => setTimeout(r, intervalMs));
    }
  }

  return {
    name: 'health-check',
    passed: false,
    detail: `${url} did not respond 200 after ${maxRetries} attempts`,
  };
}

// --- Main orchestrator ---

export async function runPreflight(
  baseUrl: string,
  mode: PreflightMode = 'full',
  config: PreflightConfig = {}
): Promise<PreflightResult> {
  const checks: CheckResult[] = [];

  if (shouldRunSetup(mode)) {
    const envCheck = checkEnvVars(config.requiredEnvVars);
    checks.push(envCheck);
    if (!envCheck.passed) {
      return { status: 'SETUP_ERROR', checks, error: envCheck.detail };
    }

    if (config.dbMigrateCommand) {
      const dbCheck = checkDbMigration(config.dbMigrateCommand);
      checks.push(dbCheck);
      if (!dbCheck.passed) {
        return { status: 'SETUP_ERROR', checks, error: dbCheck.detail };
      }
    }
  }

  if (shouldRunHealth(mode)) {
    const healthPath = config.healthEndpoint || '/api/v1/health';
    const healthCheck = await checkHealthEndpoint(baseUrl, healthPath);
    checks.push(healthCheck);
    if (!healthCheck.passed) {
      return { status: 'SETUP_ERROR', checks, error: healthCheck.detail };
    }
  }

  return { status: 'READY', checks };
}

// --- CLI entry point ---

async function main() {
  const { values } = parseArgs({
    options: {
      'base-url': { type: 'string', default: 'http://127.0.0.1:8000' },
      mode: { type: 'string', default: 'full' },
      config: { type: 'string' },
      'health-path': { type: 'string' },
      'db-migrate-command': { type: 'string' },
    },
  });

  const baseUrl = values['base-url'] || 'http://127.0.0.1:8000';
  const mode = normalizeMode(values.mode);
  const config = loadConfig(process.cwd(), values.config);

  // CLI overrides
  if (values['health-path']) config.healthEndpoint = values['health-path'];
  if (values['db-migrate-command']) config.dbMigrateCommand = values['db-migrate-command'];

  console.log(`Preflight: checking CI environment (mode: ${mode}, base URL: ${baseUrl})`);

  const result = await runPreflight(baseUrl, mode, config);

  for (const check of result.checks) {
    const icon = check.passed ? 'PASS' : 'FAIL';
    console.log(`  [${icon}] ${check.name}: ${check.detail || ''}`);
  }

  console.log(`\nPreflight result: ${result.status}`);

  if (result.status !== 'READY') {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }
}

const isDirectRun = process.argv[1]?.endsWith('preflight-ci.ts');
if (isDirectRun) {
  main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
}
