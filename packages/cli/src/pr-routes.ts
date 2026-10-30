import type { IncomingMessage, ServerResponse } from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { getRepoRoot } from '@diffity/git';
import { listPullRequests, getPrCheckoutInfo, detectRemote, prCheckoutName, isPrCheckoutName, parseGitHubRemote, type PrCheckoutInfo } from '@diffity/github';
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
    const remote = parseGitHubRemote(await git(dir, ['remote', 'get-url', 'origin']));
    return !!remote && remote.owner.toLowerCase() === owner.toLowerCase() && remote.repo.toLowerCase() === repo.toLowerCase();
  } catch {
    return false;
  }
}

// The folder holding this checkout and its sibling repos (and the PR worktrees made
// next to them). The instance may itself run inside a PR worktree, so it goes through
// the shared git dir to the primary checkout. Fixed for the process, so resolved once.
let reposRoot: Promise<string> | undefined;

function getReposRoot(): Promise<string> {
  reposRoot ??= (async () => {
    const root = getRepoRoot();
    const commonDir = await git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']).catch(() => '');
    const primary = basename(commonDir) === '.git' ? dirname(commonDir) : root;
    return dirname(primary);
  })();
  return reposRoot;
}

// Primary clones have a `.git` directory; linked worktrees (including PR checkouts)
// have a `.git` file pointing back at their clone.
function siblingDirs(parent: string): string[] {
  return readdirSync(parent, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

function isPrimaryClone(dir: string): boolean {
  try {
    return statSync(join(dir, '.git')).isDirectory();
  } catch {
    return false;
  }
}

// Tries the folder named after the repo first, so the usual case costs one git call.
async function findLocalClone(owner: string, repo: string): Promise<string | null> {
  const parent = await getReposRoot();
  const named = join(parent, repo);
  if (isPrimaryClone(named) && await remoteMatches(named, owner, repo)) {
    return named;
  }
  const candidates = siblingDirs(parent).map((name) => join(parent, name)).filter((dir) => dir !== named && isPrimaryClone(dir));
  const matches = await Promise.all(candidates.map((dir) => remoteMatches(dir, owner, repo)));
  return candidates[matches.indexOf(true)] ?? null;
}

// Same-repo PRs are checked out on their real branch, so `gh pr view` run inside the
// worktree finds the PR (which the Diff Viewer's own base-ref lookup relies on). Fork
// PRs have no branch in this remote, and git won't check out a branch that another
// worktree already has (your own PR, open in the main clone), so those stay detached;
// diffity then takes the PR number from the folder name.
async function prepareWorktree(clone: string, repo: string, number: number, info: PrCheckoutInfo): Promise<string> {
  const { baseRefName, headRefName, isCrossRepository } = info;
  const prRef = `refs/diffity/pr/${number}`;
  await git(clone, ['fetch', 'origin', baseRefName, `+pull/${number}/head:${prRef}`]);
  const sha = await git(clone, ['rev-parse', prRef]);
  const path = join(dirname(clone), prCheckoutName(repo, number));
  const branch = isCrossRepository || await isCheckedOutElsewhere(clone, headRefName, path) ? null : headRefName;

  // Next to the main clone, so the Diff Viewer lists it.
  if (!existsSync(path)) {
    await git(clone, ['worktree', 'prune']);
    await git(clone, branch ? ['worktree', 'add', '-B', branch, path, sha] : ['worktree', 'add', '--detach', path, sha]);
    if (branch) {
      await git(path, ['branch', `--set-upstream-to=origin/${branch}`, branch]).catch(() => undefined);
    }
    return path;
  }
  // One call gives HEAD's commit, its branch ("(detached)" when none) and local changes.
  const status = await git(path, ['status', '--porcelain=v2', '--branch']);
  const head = status.match(/^# branch\.oid (\S+)/m)?.[1];
  const current = status.match(/^# branch\.head (.+)$/m)?.[1];
  const dirty = status.split('\n').some((line) => line && !line.startsWith('#'));
  if (dirty || (head === sha && current === (branch ?? '(detached)'))) {
    return path;
  }
  if (branch) {
    await git(path, ['checkout', '-B', branch, sha]);
    await git(path, ['branch', `--set-upstream-to=origin/${branch}`, branch]).catch(() => undefined);
  } else {
    await git(path, ['checkout', '--detach', sha]);
  }
  return path;
}

async function isCheckedOutElsewhere(clone: string, branch: string, path: string): Promise<boolean> {
  const list = await git(clone, ['worktree', 'list', '--porcelain']);
  return list.split('\n\n').some((entry) =>
    entry.includes(`\nbranch refs/heads/${branch}`) && !entry.startsWith(`worktree ${path}\n`));
}

async function ensureInstance(worktree: string, ref: string): Promise<number> {
  const repoHash = createHash('sha256').update(worktree).digest('hex').slice(0, 12);
  const existing = findInstanceForRepo(repoHash);
  if (existing && await checkInstanceHealth(existing.port)) {
    return existing.port;
  }

  const child = spawn(process.execPath, [process.argv[1], '--no-open', '--quiet', ref], {
    cwd: worktree,
    detached: true,
    stdio: 'ignore',
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

interface OpenedPr {
  port: number;
  ref: string;
  checkout: string;
}

const inFlight = new Map<string, Promise<OpenedPr>>();

function openPr(owner: string, repo: string, number: number): Promise<OpenedPr> {
  const key = `${owner}/${repo}#${number}`;
  const pending = inFlight.get(key);
  if (pending) {
    return pending;
  }
  const job = (async () => {
    const [clone, info] = await Promise.all([findLocalClone(owner, repo), getPrCheckoutInfo(owner, repo, number)]);
    if (!clone) {
      throw new Error(`No local clone of ${owner}/${repo} found next to this repository`);
    }
    const ref = `origin/${info.baseRefName}`;
    const path = await prepareWorktree(clone, repo, number, info);
    const port = await ensureInstance(path, ref);
    return { port, ref, checkout: basename(path) };
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, job);
  return job;
}

// Searches are scoped to one org; without it `review-requested:@me` returns PRs from
// public repos too. Defaults to the owner of this checkout's origin remote.
let org: string | null | undefined;

function resolveOrg(): string | null {
  org ??= process.env.DIFFITY_PR_ORG?.trim() || detectRemote()?.owner || null;
  return org;
}

// Folder names of the PR worktrees already on disk, `<repo>-pr-<n>`.
async function localPrCheckouts(): Promise<Set<string>> {
  const parent = await getReposRoot();
  const names = siblingDirs(parent).filter((name) => isPrCheckoutName(name) && existsSync(join(parent, name, '.git')));
  return new Set(names.map((name) => name.toLowerCase()));
}

// The Diff Viewer's frame wraps an instance with its toolbar. It lives on the
// `diff-viewer--<workspace>` host, so it only exists behind the devspaces proxy, where
// every port is reached as `<port>--<workspace>`; elsewhere the instance is opened
// directly. `origin` is the page's own origin as the browser sees it.
function reviewUrl(origin: string, opened: OpenedPr): string {
  const { protocol, hostname } = new URL(origin);
  const workspace = hostname.match(/^[\w-]+?--(.+)$/)?.[1];
  if (workspace) {
    const params = new URLSearchParams({ frame: 'diffity', repo: opened.checkout, port: String(opened.port), ref: opened.ref });
    return `${protocol}//diff-viewer--${workspace}/?${params}`;
  }
  return `${protocol}//${hostname}:${opened.port}/diff?${new URLSearchParams({ ref: opened.ref })}`;
}

export async function handlePrRoute(req: IncomingMessage, res: ServerResponse, pathname: string, url: URL): Promise<boolean> {
  if (pathname === '/api/prs' && req.method === 'GET') {
    try {
      const [list, local] = await Promise.all([
        listPullRequests({
          org: resolveOrg(),
          view: url.searchParams.get('view') || undefined,
          updated: url.searchParams.get('updated') || undefined,
          query: url.searchParams.get('query') || undefined,
        }),
        localPrCheckouts(),
      ]);
      for (const section of list.sections) {
        for (const pr of section.items) {
          pr.checkedOut = local.has(prCheckoutName(pr.repo, pr.number).toLowerCase());
        }
      }
      sendJson(res, list);
    } catch (err) {
      sendError(res, 502, `Failed to list pull requests: ${err instanceof Error ? err.message : err}`);
    }
    return true;
  }

  if (pathname === '/api/prs/open' && req.method === 'POST') {
    try {
      const { owner, repo, number, origin } = JSON.parse(await readBody(req));
      if (typeof owner !== 'string' || typeof repo !== 'string' || !Number.isInteger(number)
        || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo) || typeof origin !== 'string' || !URL.canParse(origin)) {
        sendError(res, 400, 'Missing or invalid owner, repo, number or origin');
        return true;
      }
      const opened = await openPr(owner, repo, number);
      sendJson(res, { url: reviewUrl(origin, opened) });
    } catch (err) {
      sendError(res, 500, `${err instanceof Error ? err.message : err}`);
    }
    return true;
  }

  return false;
}
