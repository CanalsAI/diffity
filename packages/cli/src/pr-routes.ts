import type { IncomingMessage, ServerResponse } from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { getDiffityHome, getRepoRoot } from '@diffity/git';
import { listPullRequests, getPrBaseRefName, detectRemote } from '@diffity/github';
import { findInstanceForRepo, checkInstanceHealth } from './registry.js';
import { sendJson, sendError, readBody } from './http-utils.js';

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 5 * 60_000;
const STARTUP_TIMEOUT_MS = 30_000;

// PR worktrees are throwaway review checkouts: repo hooks (e.g. husky post-checkout)
// expect installed dependencies the worktree doesn't have, so they are skipped.
async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout.trim();
}

async function remoteMatches(dir: string, owner: string, repo: string): Promise<boolean> {
  try {
    const url = await git(dir, ['remote', 'get-url', 'origin']);
    const match = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
    return !!match && match[1].toLowerCase() === owner.toLowerCase() && match[2].toLowerCase() === repo.toLowerCase();
  } catch {
    return false;
  }
}

// The instance may itself run inside a PR worktree, so resolve the primary
// checkout through the shared git dir and look for the PR's repo next to it.
async function findLocalClone(owner: string, repo: string): Promise<string | null> {
  let mainRoot = getRepoRoot();
  try {
    const commonDir = await git(mainRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
    if (basename(commonDir) === '.git') {
      mainRoot = dirname(commonDir);
    }
  } catch {
    // keep the toplevel
  }

  const candidates = [mainRoot];
  const parent = dirname(mainRoot);
  for (const entry of readdirSync(parent, { withFileTypes: true })) {
    const dir = join(parent, entry.name);
    if (entry.isDirectory() && dir !== mainRoot && existsSync(join(dir, '.git'))) {
      candidates.push(dir);
    }
  }
  const matches = await Promise.all(candidates.map((dir) => remoteMatches(dir, owner, repo)));
  return candidates[matches.indexOf(true)] ?? null;
}

async function prepareWorktree(clone: string, owner: string, repo: string, number: number, baseRef: string): Promise<string> {
  const prRef = `refs/diffity/pr/${number}`;
  await git(clone, ['fetch', 'origin', baseRef, `+pull/${number}/head:${prRef}`]);
  const sha = await git(clone, ['rev-parse', prRef]);

  const path = join(getDiffityHome(), 'worktrees', `${owner}-${repo}-${number}`);
  if (existsSync(path)) {
    const dirty = await git(path, ['status', '--porcelain']);
    if (!dirty) {
      await git(path, ['checkout', '--detach', sha]);
    }
  } else {
    mkdirSync(dirname(path), { recursive: true });
    await git(clone, ['worktree', 'prune']);
    await git(clone, ['worktree', 'add', '--detach', path, sha]);
  }
  return path;
}

async function ensureInstance(worktree: string, baseRef: string, number: number): Promise<number> {
  const repoHash = createHash('sha256').update(worktree).digest('hex').slice(0, 12);
  const existing = findInstanceForRepo(repoHash);
  if (existing && await checkInstanceHealth(existing.port)) {
    return existing.port;
  }

  const child = spawn(process.execPath, [process.argv[1], '--no-open', '--quiet', `origin/${baseRef}`], {
    cwd: worktree,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, DIFFITY_PR_NUMBER: String(number) },
  });
  child.unref();

  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const entry = findInstanceForRepo(repoHash);
    if (entry && await checkInstanceHealth(entry.port)) {
      return entry.port;
    }
  }
  throw new Error('Timed out waiting for the PR review instance to start');
}

const inFlight = new Map<string, Promise<{ port: number; ref: string }>>();

function openPr(owner: string, repo: string, number: number): Promise<{ port: number; ref: string }> {
  const key = `${owner}/${repo}#${number}`;
  const pending = inFlight.get(key);
  if (pending) {
    return pending;
  }
  const job = (async () => {
    const [clone, baseRefName] = await Promise.all([findLocalClone(owner, repo), getPrBaseRefName(owner, repo, number)]);
    if (!clone) {
      throw new Error(`No local clone of ${owner}/${repo} found next to this repository`);
    }
    const path = await prepareWorktree(clone, owner, repo, number, baseRefName);
    const port = await ensureInstance(path, baseRefName, number);
    return { port, ref: `origin/${baseRefName}` };
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, job);
  return job;
}

// Searches are scoped to one org; without it `review-requested:@me` returns PRs from
// public repos too. Defaults to the owner of this checkout's origin remote.
function resolveOrg(): string | null {
  return process.env.DIFFITY_PR_ORG?.trim() || detectRemote()?.owner || null;
}

export async function handlePrRoute(req: IncomingMessage, res: ServerResponse, pathname: string, url: URL): Promise<boolean> {
  if (pathname === '/api/prs' && req.method === 'GET') {
    try {
      sendJson(res, await listPullRequests({
        org: resolveOrg(),
        view: url.searchParams.get('view') || undefined,
        updated: url.searchParams.get('updated') || undefined,
        query: url.searchParams.get('query') || undefined,
      }));
    } catch (err) {
      sendError(res, 502, `Failed to list pull requests: ${err instanceof Error ? err.message : err}`);
    }
    return true;
  }

  if (pathname === '/api/prs/open' && req.method === 'POST') {
    try {
      const { owner, repo, number } = JSON.parse(await readBody(req));
      if (typeof owner !== 'string' || typeof repo !== 'string' || !Number.isInteger(number)
        || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) {
        sendError(res, 400, 'Missing or invalid owner, repo or number');
        return true;
      }
      sendJson(res, await openPr(owner, repo, number));
    } catch (err) {
      sendError(res, 500, `${err instanceof Error ? err.message : err}`);
    }
    return true;
  }

  return false;
}
