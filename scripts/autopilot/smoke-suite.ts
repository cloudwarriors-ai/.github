/**
 * smoke-suite.ts
 *
 * Config-driven resolution of which smoke specs are safe for local CI execution.
 * Reads baseline directory and exclusion patterns from .autopilot/config.json.
 *
 * Usage:
 *   npx tsx smoke-suite.ts
 *   npx tsx smoke-suite.ts --config .autopilot/config.json
 *
 * Outputs a newline-separated list of safe smoke spec paths to stdout.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

// --- Types ---

export interface SmokeSpec {
  path: string;
  safe: boolean;
  reason?: string;
}

export interface SmokeConfig {
  baselineDir?: string;
  specExtensions?: string[];
  excludePatterns?: RegExp[];
}

// --- Config ---

function loadSmokeConfig(rootDir: string, configPath?: string): SmokeConfig {
  const path = configPath || join(rootDir, '.autopilot', 'config.json');
  if (existsSync(path)) {
    const config = JSON.parse(readFileSync(path, 'utf-8'));
    return {
      baselineDir: config.smokeBaselineDir || 'tests/e2e/baseline',
      specExtensions: config.smokeSpecExtensions || ['.spec.ts', '.spec.tsx'],
      excludePatterns: (config.smokeExcludePatterns || ['browserbase\\.fixture'])
        .map((p: string) => new RegExp(p)),
    };
  }
  return {
    baselineDir: 'tests/e2e/baseline',
    specExtensions: ['.spec.ts', '.spec.tsx'],
    excludePatterns: [/from\s+['"].*browserbase\.fixture['"]/],
  };
}

// --- Checks ---

export function isSpecSafe(filePath: string, excludePatterns: RegExp[]): boolean {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return !excludePatterns.some(p => p.test(content));
  } catch {
    return false;
  }
}

// --- Resolver ---

export function resolveSmokeSpecs(rootDir: string, config?: SmokeConfig): SmokeSpec[] {
  const cfg = config || loadSmokeConfig(rootDir);
  const baselineDir = join(rootDir, cfg.baselineDir || 'tests/e2e/baseline');

  if (!existsSync(baselineDir)) return [];

  const extensions = cfg.specExtensions || ['.spec.ts', '.spec.tsx'];
  const files = readdirSync(baselineDir).filter(
    f => extensions.some(ext => f.endsWith(ext))
  );

  const excludePatterns = cfg.excludePatterns || [/from\s+['"].*browserbase\.fixture['"]/];

  return files.map(f => {
    const fullPath = join(baselineDir, f);
    const safe = isSpecSafe(fullPath, excludePatterns);
    return {
      path: fullPath,
      safe,
      reason: safe ? undefined : 'Matches exclusion pattern — not safe for local CI',
    };
  });
}

export function getSafeSmokePaths(rootDir: string, config?: SmokeConfig): string[] {
  return resolveSmokeSpecs(rootDir, config)
    .filter(s => s.safe)
    .map(s => s.path);
}

// --- CLI ---

function main() {
  const { values } = parseArgs({
    options: {
      config: { type: 'string', short: 'c' },
    },
  });

  const rootDir = process.cwd();
  const config = loadSmokeConfig(rootDir, values.config);
  const specs = resolveSmokeSpecs(rootDir, config);

  const safe = specs.filter(s => s.safe);
  const unsafe = specs.filter(s => !s.safe);

  if (unsafe.length > 0) {
    console.error(`Excluded ${unsafe.length} spec(s):`);
    for (const s of unsafe) {
      console.error(`  - ${s.path.split('/').pop()}: ${s.reason}`);
    }
    console.error('');
  }

  if (safe.length === 0) {
    console.error('No safe smoke specs found');
    process.exit(1);
  }

  console.log(`Safe smoke specs (${safe.length}):`);
  for (const s of safe) {
    console.log(s.path);
  }
}

const isDirectRun = process.argv[1]?.endsWith('smoke-suite.ts');
if (isDirectRun) {
  main();
}
