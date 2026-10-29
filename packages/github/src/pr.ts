import { execSync } from 'node:child_process';
import { exec } from './exec.js';
import type { PrComment, PushResult, PulledThread } from './types.js';

export function getFiles(owner: string, repo: string, prNumber: number): Set<string> {
  try {
    const raw = exec(
      `gh api repos/${owner}/${repo}/pulls/${prNumber}/files --jq '.[].filename'`,
    );
    return new Set(raw.split('\n').filter(Boolean));
  } catch {
    return new Set();
  }
}

interface ExistingComment {
  path: string;
  line: number;
  side: string;
  body: string;
}

export function getComments(owner: string, repo: string, prNumber: number): ExistingComment[] {
  try {
    const json = execSync(
      `gh api repos/${owner}/${repo}/pulls/${prNumber}/comments --paginate`,
      { encoding: 'utf-8', stdio: 'pipe', maxBuffer: 10 * 1024 * 1024 },
    ).trim();
    if (!json) {
      return [];
    }
    const data = JSON.parse(json);
    if (!Array.isArray(data)) {
      return [];
    }
    return data.map((c: { path: string; line: number; side: string; body: string }) => ({
      path: c.path,
      line: c.line,
      side: c.side,
      body: c.body,
    }));
  } catch {
    return [];
  }
}

export function getCommentCount(owner: string, repo: string, prNumber: number): number {
  return getComments(owner, repo, prNumber).length;
}

interface GitHubCommentRaw {
  id: number;
  path: string;
  line: number;
  start_line: number | null;
  side: string;
  body: string;
  in_reply_to_id: number | null;
  user: { login: string; type: string };
  created_at: string;
}

export function pullComments(owner: string, repo: string, prNumber: number): PulledThread[] {
  try {
    const json = execSync(
      `gh api repos/${owner}/${repo}/pulls/${prNumber}/comments --paginate`,
      { encoding: 'utf-8', stdio: 'pipe', maxBuffer: 10 * 1024 * 1024 },
    ).trim();
    if (!json) {
      return [];
    }
    const data = JSON.parse(json) as GitHubCommentRaw[];
    if (!Array.isArray(data)) {
      return [];
    }

    const rootComments = data.filter(c => c.line !== null && !c.in_reply_to_id);
    const repliesByRoot = new Map<number, GitHubCommentRaw[]>();
    for (const c of data) {
      if (c.in_reply_to_id) {
        const list = repliesByRoot.get(c.in_reply_to_id) ?? [];
        list.push(c);
        repliesByRoot.set(c.in_reply_to_id, list);
      }
    }

    return rootComments.map(root => {
      const replies = repliesByRoot.get(root.id) ?? [];
      const allComments = [root, ...replies];
      return {
        filePath: root.path,
        side: root.side === 'LEFT' ? 'old' as const : 'new' as const,
        startLine: root.start_line ?? root.line,
        endLine: root.line,
        comments: allComments.map(c => ({
          body: c.body,
          authorName: c.user.login,
          authorType: c.user.type === 'Bot' ? 'agent' as const : 'user' as const,
          createdAt: c.created_at,
        })),
      };
    });
  } catch {
    return [];
  }
}

function toGitHubComment(comment: PrComment): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    path: comment.filePath,
    body: comment.body,
    side: comment.side,
    line: comment.endLine,
  };
  if (comment.startLine && comment.startLine !== comment.endLine) {
    entry.start_line = comment.startLine;
    entry.start_side = comment.side;
  }
  return entry;
}

function isDuplicate(existing: ExistingComment[], comment: PrComment): boolean {
  return existing.some(e =>
    e.path === comment.filePath &&
    e.line === comment.endLine &&
    e.side === comment.side &&
    e.body === comment.body,
  );
}

export function pushComments(
  owner: string,
  repo: string,
  prNumber: number,
  headSha: string,
  comments: PrComment[],
): PushResult {
  const prFiles = getFiles(owner, repo, prNumber);
  const existing = getComments(owner, repo, prNumber);

  let pushed = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const comment of comments) {
    if (!prFiles.has(comment.filePath)) {
      failed++;
      errors.push(`${comment.filePath} — not in PR diff (push your changes first)`);
      continue;
    }

    if (isDuplicate(existing, comment)) {
      skipped++;
      continue;
    }

    try {
      const payload = { ...toGitHubComment(comment), commit_id: headSha };
      execSync(
        `gh api repos/${owner}/${repo}/pulls/${prNumber}/comments --method POST --input -`,
        {
          input: JSON.stringify(payload),
          encoding: 'utf-8',
          stdio: 'pipe',
        },
      );
      pushed++;
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      const ghLine = msg.split('\n').find(l => l.includes('gh:'));
      errors.push(`${comment.filePath}:${comment.endLine} — ${ghLine ? ghLine.trim() : 'GitHub API error'}`);
    }
  }

  return { pushed, skipped, failed, errors };
}

export type ReviewEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';

export interface ReviewResult {
  url: string | null;
  posted: number;
}

// Posts one review (verdict + summary + inline comments) so GitHub sends a single
// notification. Comments already on the PR are dropped to keep re-submits idempotent.
export function submitReview(
  owner: string,
  repo: string,
  prNumber: number,
  headSha: string,
  event: ReviewEvent,
  body: string,
  comments: PrComment[],
): ReviewResult {
  const existing = getComments(owner, repo, prNumber);
  const fresh = comments.filter((comment) => !isDuplicate(existing, comment));

  const payload: Record<string, unknown> = {
    commit_id: headSha,
    event,
    comments: fresh.map(toGitHubComment),
  };
  if (body) {
    payload.body = body;
  }

  try {
    const out = execSync(
      `gh api repos/${owner}/${repo}/pulls/${prNumber}/reviews --method POST --input -`,
      { input: JSON.stringify(payload), encoding: 'utf-8', stdio: 'pipe', maxBuffer: 10 * 1024 * 1024 },
    );
    const review = JSON.parse(out) as { html_url?: string };
    return { url: review.html_url ?? null, posted: fresh.length };
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? '';
    const msg = stderr.split('\n').find((l) => l.trim()) ?? (err instanceof Error ? err.message : String(err));
    throw new Error(msg.trim());
  }
}
