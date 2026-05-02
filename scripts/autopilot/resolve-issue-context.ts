/**
 * resolve-issue-context.ts
 *
 * Fetches issue metadata from GitHub and resolves the autopilot context:
 * track (bug/feature), canonical base branch, head branch, linked PR.
 *
 * Generic — works across any repo in the cloudwarriors-ai org.
 *
 * Usage:
 *   npx tsx scripts/autopilot/resolve-issue-context.ts --issue 123
 *   npx tsx scripts/autopilot/resolve-issue-context.ts --issue 123 --owner cloudwarriors-ai --repo studio
 *
 * Outputs JSON to stdout. Non-zero exit on failure.
 */

import { parseArgs } from 'node:util';

// --- Types ---

export interface IssueContext {
  issueId: number;
  title: string;
  state: string;
  track: 'bugs' | 'features';
  base: string;         // target branch for PRs (repo default branch)
  head: string;         // canonical branch name: autofix/issue-<id>
  linkedPR: LinkedPR | null;
  labels: string[];
  status: 'resolved' | 'error';
  error?: string;
}

export interface LinkedPR {
  number: number;
  title: string;
  headBranch: string;
  baseBranch: string;
  state: string;
  isCanonical: boolean;
}

// --- Track resolution ---

export function resolveTrackFromLabels(labels: string[]): 'bugs' | 'features' | null {
  if (labels.includes('TRACK: Bug')) return 'bugs';
  if (labels.includes('TRACK: Feature')) return 'features';
  return null;
}

export function resolveTrackFromTitle(title: string): 'bugs' | 'features' | null {
  const lower = title.toLowerCase();
  if (lower.startsWith('bug:') || lower.startsWith('[bug]')) return 'bugs';
  if (lower.startsWith('feature:') || lower.startsWith('[feature]') || lower.startsWith('feat:')) return 'features';
  return null;
}

export function resolveTrack(labels: string[], title: string): 'bugs' | 'features' | null {
  return resolveTrackFromLabels(labels) ?? resolveTrackFromTitle(title);
}

// --- Base branch resolution ---

export async function resolveBase(owner: string, repo: string, token: string): Promise<string> {
  // Shadow repos declare their integration branch in .shadow/config.json.
  // autofix/* must target dev (the integration branch), not main (production).
  if (repo.endsWith('-shadow')) {
    try {
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/.shadow/config.json`,
        { headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' } }
      );
      if (res.ok) {
        const file = await res.json();
        const config = JSON.parse(Buffer.from(file.content, 'base64').toString());
        if (config.integrationBranch) return config.integrationBranch;
      }
    } catch {}
    return 'dev';
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github+json',
      },
    });
    if (res.ok) {
      const data = await res.json();
      return data.default_branch || 'main';
    }
  } catch {}
  return 'main';
}

// --- Canonical head branch ---

export function canonicalHead(issueId: number): string {
  return `autofix/issue-${issueId}`;
}

// --- GitHub API helpers ---

interface GitHubOptions {
  owner: string;
  repo: string;
  token: string;
}

async function ghFetch(path: string, opts: GitHubOptions): Promise<any> {
  const url = `https://api.github.com${path}`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${opts.token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${res.status}: ${path} — ${body}`);
  }

  return res.json();
}

async function fetchIssue(issueId: number, opts: GitHubOptions) {
  return ghFetch(`/repos/${opts.owner}/${opts.repo}/issues/${issueId}`, opts);
}

async function findLinkedPR(issueId: number, opts: GitHubOptions): Promise<LinkedPR | null> {
  const prs = await ghFetch(`/repos/${opts.owner}/${opts.repo}/pulls?state=open&per_page=100`, opts);

  const canonical = canonicalHead(issueId);
  const issueRef = `#${issueId}`;

  for (const pr of prs) {
    if (pr.head?.ref === canonical) {
      return {
        number: pr.number,
        title: pr.title,
        headBranch: pr.head.ref,
        baseBranch: pr.base.ref,
        state: pr.state,
        isCanonical: true,
      };
    }

    const titleAndBody = `${pr.title || ''} ${pr.body || ''}`;
    if (titleAndBody.includes(issueRef) || titleAndBody.toLowerCase().includes(`issue ${issueId}`)) {
      return {
        number: pr.number,
        title: pr.title,
        headBranch: pr.head.ref,
        baseBranch: pr.base.ref,
        state: pr.state,
        isCanonical: pr.head.ref === canonical,
      };
    }
  }

  return null;
}

// --- Main ---

export async function resolveIssueContext(
  issueId: number,
  opts: GitHubOptions
): Promise<IssueContext> {
  const issue = await fetchIssue(issueId, opts);
  const labels: string[] = (issue.labels || []).map((l: any) =>
    typeof l === 'string' ? l : l.name
  );
  const title: string = issue.title || '';

  const base = await resolveBase(opts.owner, opts.repo, opts.token);

  const track = resolveTrack(labels, title);
  if (!track) {
    return {
      issueId,
      title,
      state: issue.state,
      track: 'bugs',
      base,
      head: canonicalHead(issueId),
      linkedPR: null,
      labels,
      status: 'error',
      error: `Cannot resolve track for issue #${issueId}. Add a "TRACK: Bug" or "TRACK: Feature" label, or prefix the title with "Bug:" or "Feature:".`,
    };
  }

  const head = canonicalHead(issueId);
  const linkedPR = await findLinkedPR(issueId, opts);

  return {
    issueId,
    title,
    state: issue.state,
    track,
    base,
    head,
    linkedPR,
    labels,
    status: 'resolved',
  };
}

// --- CLI entry point ---

async function main() {
  const { values } = parseArgs({
    options: {
      issue: { type: 'string', short: 'i' },
      owner: { type: 'string', short: 'o' },
      repo: { type: 'string', short: 'r' },
    },
  });

  const issueId = parseInt(values.issue || '', 10);
  if (!issueId || isNaN(issueId)) {
    console.error('Usage: npx tsx resolve-issue-context.ts --issue <number> [--owner <owner>] [--repo <repo>]');
    process.exit(1);
  }

  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
  if (!token) {
    console.error('Error: GITHUB_TOKEN or GH_TOKEN environment variable required');
    process.exit(1);
  }

  const owner = values.owner || process.env.GITHUB_REPOSITORY_OWNER || 'cloudwarriors-ai';
  const repo = values.repo || process.env.GITHUB_REPOSITORY?.split('/')[1] || '';

  if (!repo) {
    console.error('Error: --repo is required (or set GITHUB_REPOSITORY)');
    process.exit(1);
  }

  const ctx = await resolveIssueContext(issueId, { owner, repo, token });

  console.log(JSON.stringify(ctx, null, 2));

  if (ctx.status === 'error') {
    process.exit(1);
  }
}

const isDirectRun = process.argv[1]?.endsWith('resolve-issue-context.ts');
if (isDirectRun) {
  main().catch((err) => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
}
