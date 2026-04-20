#!/usr/bin/env tsx
/**
 * Signed-attestation tool for the API validation harness.
 *
 * The autopilot pipeline runs validation once, then emits an attestation
 * that downstream verifiers (shadow-upstream-pr) can check without re-running
 * the scenarios. This preserves the single-validation invariant from the plan.
 *
 * Signature: HMAC-SHA256 over a canonical "\n"-joined field ordering with a
 * shared org-level secret (VALIDATION_ATTESTATION_KEY).
 *
 * Subcommands:
 *   sign   --report <path> --commit-sha <sha> --run-id <id> --repo <owner/name>
 *          --verdict <v> --manifest <path> [--out <path>]
 *   verify --attestation <path> --commit-sha <sha> [--max-age-days <n>]
 *          [--report <path>]   (if given, verifies report hash too)
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const SCHEMA_VERSION = '1';
const HMAC_ENV = 'VALIDATION_ATTESTATION_KEY';

interface Attestation {
  schema_version: string;
  signed_at: string;
  commit_sha: string;
  workflow_run_id: string;
  source_repo: string;
  verdict: string;
  report_sha256: string;
  manifest_sha256: string;
  hmac_sha256: string;
}

function sha256File(path: string): string {
  const bytes = readFileSync(path);
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalPayload(a: Omit<Attestation, 'hmac_sha256'>): string {
  return [
    a.schema_version,
    a.signed_at,
    a.commit_sha,
    a.workflow_run_id,
    a.source_repo,
    a.verdict,
    a.report_sha256,
    a.manifest_sha256,
  ].join('\n');
}

function signHmac(payload: string): string {
  const key = process.env[HMAC_ENV];
  if (!key) throw new Error(`missing ${HMAC_ENV} env var`);
  return createHmac('sha256', key).update(payload).digest('hex');
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!flag.startsWith('--')) continue;
    const key = flag.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = 'true';
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function cmdSign(args: Record<string, string>): void {
  const required = ['report', 'commit-sha', 'run-id', 'repo', 'verdict', 'manifest'];
  for (const k of required) {
    if (!args[k]) {
      console.error(`sign: missing --${k}`);
      process.exit(2);
    }
  }

  const attestation: Omit<Attestation, 'hmac_sha256'> = {
    schema_version: SCHEMA_VERSION,
    signed_at: new Date().toISOString(),
    commit_sha: args['commit-sha'],
    workflow_run_id: args['run-id'],
    source_repo: args['repo'],
    verdict: args['verdict'],
    report_sha256: sha256File(args['report']),
    manifest_sha256: sha256File(args['manifest']),
  };

  const hmac = signHmac(canonicalPayload(attestation));
  const signed: Attestation = { ...attestation, hmac_sha256: hmac };

  const out = args['out'] || 'attestation.json';
  writeFileSync(out, JSON.stringify(signed, null, 2) + '\n');
  console.log(`signed attestation → ${out}`);
  console.log(`  verdict=${signed.verdict} report_sha=${signed.report_sha256.slice(0, 12)}...`);
}

function cmdVerify(args: Record<string, string>): void {
  if (!args['attestation']) {
    console.error('verify: missing --attestation');
    process.exit(2);
  }
  if (!args['commit-sha']) {
    console.error('verify: missing --commit-sha');
    process.exit(2);
  }

  const raw = readFileSync(args['attestation'], 'utf-8');
  const a = JSON.parse(raw) as Attestation;

  const problems: string[] = [];

  if (a.schema_version !== SCHEMA_VERSION) {
    problems.push(`schema_version mismatch: got ${a.schema_version}, want ${SCHEMA_VERSION}`);
  }

  if (a.commit_sha !== args['commit-sha']) {
    problems.push(`commit_sha mismatch: attestation=${a.commit_sha.slice(0, 12)} caller=${args['commit-sha'].slice(0, 12)}`);
  }

  const maxAgeDays = args['max-age-days'] ? Number(args['max-age-days']) : 14;
  const signedAt = Date.parse(a.signed_at);
  if (Number.isNaN(signedAt)) {
    problems.push(`signed_at not parseable: ${a.signed_at}`);
  } else {
    const ageMs = Date.now() - signedAt;
    const maxMs = maxAgeDays * 24 * 60 * 60 * 1000;
    if (ageMs > maxMs) {
      const days = (ageMs / (24 * 60 * 60 * 1000)).toFixed(1);
      problems.push(`attestation too old: ${days}d > ${maxAgeDays}d`);
    }
  }

  const expected = signHmac(canonicalPayload(a));
  const got = Buffer.from(a.hmac_sha256, 'hex');
  const want = Buffer.from(expected, 'hex');
  if (got.length !== want.length || !timingSafeEqual(got, want)) {
    problems.push('hmac mismatch');
  }

  if (args['report']) {
    try {
      const actualReportSha = sha256File(args['report']);
      if (actualReportSha !== a.report_sha256) {
        problems.push(`report_sha256 mismatch: file=${actualReportSha.slice(0, 12)} attestation=${a.report_sha256.slice(0, 12)}`);
      }
    } catch (err) {
      problems.push(`could not hash report: ${(err as Error).message}`);
    }
  }

  if (problems.length > 0) {
    console.error('attestation INVALID:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  const verdictGate = a.verdict === 'regression' ? 'FAIL' : 'PASS';
  const ageSeconds = Math.floor((Date.now() - Date.parse(a.signed_at)) / 1000);
  console.log('attestation VALID');
  console.log(`  verdict=${a.verdict} gate=${verdictGate} age=${ageSeconds}s`);
  console.log(`  run_id=${a.workflow_run_id} commit=${a.commit_sha.slice(0, 12)}`);

  if (a.verdict === 'regression') {
    console.error('verdict=regression → failing verifier');
    process.exit(1);
  }
}

function main(): void {
  const [, , sub, ...rest] = process.argv;
  if (sub === 'sign') {
    cmdSign(parseArgs(rest));
  } else if (sub === 'verify') {
    cmdVerify(parseArgs(rest));
  } else {
    console.error('usage: attestation.ts sign|verify [flags]');
    process.exit(2);
  }
}

main();
