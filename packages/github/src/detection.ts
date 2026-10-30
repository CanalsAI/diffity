import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import { exec, execSilent } from './exec.js';
import type { GitHubRemote, GitHubDetails } from './types.js';

export function parseGitHubRemote(url: string): GitHubRemote | null {
  const match = url.trim().match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  return match ? { owner: match[1], repo: match[2] } : null;
}

export function getRemote(): GitHubRemote | null {
  try {
    return parseGitHubRemote(exec('git remote get-url origin'));
  } catch {
    return null;
  }
}

export function isCliInstalled(): boolean {
  return execSilent('gh --version');
}

export function isAuthenticated(): boolean {
  return execSilent('gh auth status');
}

export function detectRemote(): GitHubRemote | null {
  return getRemote();
}

export async function fetchDetails(owner: string, repo: string): Promise<GitHubDetails | null> {
  if (!isCliInstalled() || !isAuthenticated()) {
    return null;
  }

  const pr = getPr(owner, repo);
  if (!pr) {
    return null;
  }

  const commentCount = getReviewCommentCount(owner, repo, pr.number);

  return {
    prNumber: pr.number,
    prTitle: pr.title,
    prUrl: pr.url,
    prCreatedAt: pr.createdAt,
    isOwnPr: isSameLogin(await getViewerLogin(), pr.author),
    headSha: pr.headSha,
    commentCount,
  };
}

interface PrData {
  number: number;
  title: string;
  url: string;
  headSha: string;
  createdAt: string;
  author: string | null;
}

// PR review worktrees are named `<repo>-pr-<number>`. Fork PRs are checked out detached,
// so `gh pr view` can't infer the PR from a branch; the folder name says which one.
export function prCheckoutName(repo: string, number: number): string {
  return `${repo}-pr-${number}`;
}

function prNumberFromCheckoutName(name: string): number | null {
  const match = name.match(/-pr-(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

export function isPrCheckoutName(name: string): boolean {
  return prNumberFromCheckoutName(name) !== null;
}

let checkoutPrNumber: number | null | undefined;

// The checkout a server runs in never changes, so the lookup is done once.
export function prNumberFromCheckout(): number | null {
  if (checkoutPrNumber === undefined) {
    try {
      checkoutPrNumber = prNumberFromCheckoutName(basename(exec('git rev-parse --show-toplevel')));
    } catch {
      checkoutPrNumber = null;
    }
  }
  return checkoutPrNumber;
}

function getPr(owner: string, repo: string): PrData | null {
  try {
    const number = prNumberFromCheckout();
    const target = number ? `${number} --repo ${owner}/${repo} ` : '';
    const json = exec(`gh pr view ${target}--json number,title,url,headRefOid,createdAt,author`);
    const data = JSON.parse(json);
    if (data.number && data.url && data.headRefOid) {
      return {
        number: data.number,
        title: data.title,
        url: data.url,
        headSha: data.headRefOid,
        createdAt: data.createdAt,
        author: data.author?.login ?? null,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function getReviewCommentCount(owner: string, repo: string, prNumber: number): number {
  try {
    const raw = exec(
      `gh api repos/${owner}/${repo}/pulls/${prNumber}/comments --jq 'length'`,
    );
    return parseInt(raw, 10) || 0;
  } catch {
    return 0;
  }
}

let viewerLogin: Promise<string | null> | undefined;

// The authenticated login never changes for a running server, so it is looked up
// once (a failed lookup is remembered as null rather than retried per request).
export function getViewerLogin(): Promise<string | null> {
  viewerLogin ??= new Promise((resolve) => {
    execFile('gh', ['api', 'user', '--jq', '.login'], (err, stdout) => resolve(err ? null : stdout.trim() || null));
  });
  return viewerLogin;
}

function isSameLogin(a: string | null, b: string | null): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}
