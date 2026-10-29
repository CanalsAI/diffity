import type { ParsedDiff } from '@diffity/parser';
import { isAskingDuringSubmit } from './ask-intent';
import type { CommentThread, CommentAuthor, CommentSide, Comment } from '../components/comments/types';

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new Error(json?.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function apiVoid(url: string, init?: RequestInit): Promise<void> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new Error(json?.error || `HTTP ${res.status}`);
  }
}

function buildUrl(path: string, params?: Record<string, string | undefined>): string {
  if (!params) {
    return path;
  }
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      searchParams.set(key, value);
    }
  }
  const query = searchParams.toString();
  return query ? `${path}?${query}` : path;
}

export interface GitHubRemote {
  owner: string;
  repo: string;
}

export interface GitHubDetails {
  prNumber: number;
  prTitle: string;
  prUrl: string;
  prCreatedAt: string;
  isOwnPr: boolean;
  headSha: string;
  commentCount: number;
}

export interface RepoInfo {
  name: string;
  branch: string;
  root: string;
  hostname: string;
  description: string;
  capabilities?: { reviews: boolean; revert: boolean; staleness: boolean };
  sessionId?: string | null;
  github?: GitHubRemote | null;
  editor?: 'vscode' | null;
  askAgent?: boolean;
}

export interface Commit {
  hash: string;
  shortHash: string;
  message: string;
  relativeDate: string;
}

export interface OverviewFile {
  path: string;
  status: 'staged' | 'modified' | 'added';
}

export interface Overview {
  files: OverviewFile[];
}

export interface CommitsPage {
  commits: Commit[];
  hasMore: boolean;
}

export function fetchDiff(hideWhitespace: boolean, ref?: string): Promise<ParsedDiff> {
  return apiFetch(buildUrl('/api/diff', {
    whitespace: hideWhitespace ? 'hide' : undefined,
    ref,
  }));
}

export interface DiffSummary {
  fileCount: number;
  threshold: number;
}

export function fetchDiffSummary(ref?: string): Promise<DiffSummary> {
  return apiFetch(buildUrl('/api/diff/summary', { ref }));
}

export async function fetchDiffFingerprint(ref?: string): Promise<string> {
  const json = await apiFetch<{ fingerprint: string }>(buildUrl('/api/diff-fingerprint', { ref }));
  return json.fingerprint;
}

export function fetchRepoInfo(ref?: string): Promise<RepoInfo> {
  return apiFetch(buildUrl('/api/info', { ref }));
}

export function openInEditor(filePath: string, line?: number): Promise<{ ok: boolean }> {
  return apiFetch('/api/open-in-editor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath, line }),
  });
}

export function fetchOverview(): Promise<Overview> {
  return apiFetch('/api/overview');
}

export function fetchCommits(skip = 0, count = 10, search?: string): Promise<CommitsPage> {
  return apiFetch(buildUrl('/api/commits', { skip: String(skip), count: String(count), search }));
}

export async function fetchSession(): Promise<{ id: string; ref: string; headHash: string } | null> {
  const res = await fetch('/api/sessions/current');
  if (!res.ok) {
    return null;
  }
  return res.json();
}

export function fetchThreads(sessionId: string, status?: string): Promise<CommentThread[]> {
  return apiFetch(buildUrl('/api/threads', { session: sessionId, status }));
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export function createThread(data: {
  sessionId: string;
  filePath: string;
  side: CommentSide;
  startLine: number;
  endLine: number;
  body: string;
  author: CommentAuthor;
  anchorContent?: string;
}): Promise<CommentThread> {
  return apiFetch('/api/threads', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ ...data, ask: isAskingDuringSubmit() }),
  });
}

export function replyToThread(threadId: string, body: string, author: CommentAuthor): Promise<Comment> {
  return apiFetch(`/api/threads/${threadId}/reply`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ body, author, ask: isAskingDuringSubmit() }),
  });
}

export function updateThreadStatus(threadId: string, status: string, summary?: string): Promise<void> {
  return apiVoid(`/api/threads/${threadId}/status`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ status, summary }),
  });
}

export function deleteAllThreads(sessionId: string): Promise<void> {
  return apiVoid('/api/threads', {
    method: 'DELETE',
    headers: JSON_HEADERS,
    body: JSON.stringify({ sessionId }),
  });
}

export function deleteThread(threadId: string): Promise<void> {
  return apiVoid(`/api/threads/${threadId}`, { method: 'DELETE' });
}

export function editComment(commentId: string, body: string): Promise<void> {
  return apiVoid(`/api/comments/${commentId}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ body }),
  });
}

export function deleteComment(commentId: string): Promise<void> {
  return apiVoid(`/api/comments/${commentId}`, { method: 'DELETE' });
}

export interface ViewedFiles {
  viewed: string[];
  viewedAt: Record<string, string>;
}

export function fetchViewedFiles(ref?: string): Promise<ViewedFiles> {
  return apiFetch(buildUrl('/api/viewed', { ref }));
}

export function markFileViewed(filePath: string, ref?: string): Promise<void> {
  return apiVoid('/api/viewed', {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ filePath, ref }),
    // keepalive lets the request finish even if the user reloads/navigates
    // right after toggling — otherwise the in-flight fetch is aborted and the
    // change is silently lost.
    keepalive: true,
  });
}

export function unmarkFileViewed(filePath: string, ref?: string): Promise<void> {
  // Params go in the query string (no body): the devspaces proxy drops request
  // bodies from DELETE, so a body-carrying DELETE hangs upstream forever.
  return apiVoid(buildUrl('/api/viewed', { filePath, ref }), {
    method: 'DELETE',
    keepalive: true,
  });
}

export function revertFile(filePath: string, isUntracked: boolean): Promise<void> {
  return apiVoid('/api/revert-file', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ filePath, isUntracked }),
  });
}

export function revertHunk(patch: string): Promise<void> {
  return apiVoid('/api/revert-hunk', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ patch }),
  });
}

export async function fetchFileContent(filePath: string, ref?: string): Promise<string[]> {
  const json = await apiFetch<{ content: string[] }>(
    buildUrl(`/api/file/${encodeURIComponent(filePath)}`, { ref }),
  );
  return json.content;
}

export interface PushCommentsResult {
  pushed: number;
  skipped: number;
  failed: number;
  errors: string[];
}

export interface PrCommentPayload {
  filePath: string;
  side: 'LEFT' | 'RIGHT';
  startLine: number | null;
  endLine: number;
  body: string;
}

export function toPrCommentPayload(thread: Pick<CommentThread, 'filePath' | 'side' | 'startLine' | 'endLine'>, body: string): PrCommentPayload {
  return {
    filePath: thread.filePath,
    side: thread.side === 'old' ? 'LEFT' : 'RIGHT',
    startLine: thread.startLine !== thread.endLine ? thread.startLine : null,
    endLine: thread.endLine,
    body,
  };
}

export async function fetchGitHubDetails(): Promise<GitHubDetails | null> {
  const res = await fetch('/api/github/details');
  if (!res.ok) {
    return null;
  }
  return res.json();
}

export function pushCommentsToGitHub(comments: PrCommentPayload[]): Promise<PushCommentsResult> {
  return apiFetch('/api/github/push-comments', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ comments }),
  });
}

export type ReviewEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';

export interface SubmitReviewResult {
  url: string | null;
  posted: number;
}

export function submitGitHubReview(event: ReviewEvent, body: string, comments: PrCommentPayload[]): Promise<SubmitReviewResult> {
  return apiFetch('/api/github/submit-review', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ event, body, comments }),
  });
}

export interface PullCommentsResult {
  pulled: number;
  skipped: number;
}

export function pullCommentsFromGitHub(sessionId: string): Promise<PullCommentsResult> {
  return apiFetch('/api/github/pull-comments', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ sessionId }),
  });
}

export interface TourStep {
  id: string;
  tourId: string;
  sortOrder: number;
  filePath: string;
  startLine: number;
  endLine: number;
  body: string;
  annotation: string;
  createdAt: string;
}

export interface Tour {
  id: string;
  sessionId: string;
  topic: string;
  body: string;
  status: string;
  createdAt: string;
  steps: TourStep[];
}

export function fetchTour(tourId: string): Promise<Tour> {
  return apiFetch(`/api/tours/${tourId}`);
}

export interface TreeEntryResponse {
  type: 'blob' | 'tree';
  path: string;
  name: string;
}

export function fetchTreePaths(): Promise<{ paths: string[] }> {
  return apiFetch('/api/tree');
}

export function fetchTreeEntries(dirPath?: string): Promise<{ entries: TreeEntryResponse[] }> {
  return apiFetch(buildUrl('/api/tree/entries', { path: dirPath }));
}

export function fetchTreeInfo(): Promise<RepoInfo> {
  return apiFetch('/api/tree/info');
}

export async function fetchTreeFingerprint(): Promise<string> {
  const json = await apiFetch<{ fingerprint: string }>('/api/tree/fingerprint');
  return json.fingerprint;
}

export async function fetchTreeFileContent(filePath: string): Promise<string[]> {
  const json = await apiFetch<{ content: string[] }>(
    `/api/tree/file/${encodeURIComponent(filePath)}`,
  );
  return json.content;
}

export interface PrStatus {
  label: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
}

export interface PrListItem {
  owner: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string;
  updatedAt: string;
  commentCount: number;
  labels: { name: string; color: string }[];
  status: PrStatus;
}

export interface PrTeam {
  slug: string;
  name: string;
}

export interface PrListResponse {
  viewer: string | null;
  org: string | null;
  teams: PrTeam[];
  sections: { id: string; title: string; items: PrListItem[] }[];
}

export interface PrListParams {
  view: string;
  updated: string;
  query: string;
}

export function fetchPullRequests(params: PrListParams): Promise<PrListResponse> {
  return apiFetch(buildUrl('/api/prs', {
    view: params.view,
    updated: params.updated || undefined,
    query: params.view === 'custom' ? params.query : undefined,
  }));
}

export function openPullRequest(pr: Pick<PrListItem, 'owner' | 'repo' | 'number'>): Promise<{ port: number; ref: string }> {
  return apiFetch('/api/prs/open', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ owner: pr.owner, repo: pr.repo, number: pr.number }),
  });
}

export function askAgent(threadId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/threads/${threadId}/ask`, { method: 'POST' });
}

export function fetchPendingAsks(): Promise<{ threadIds: string[] }> {
  return apiFetch('/api/ask/pending');
}

export function runReview(): Promise<{ ok: boolean }> {
  return apiFetch('/api/review/run', { method: 'POST' });
}

export function fetchReviewStatus(): Promise<{ running: boolean }> {
  return apiFetch('/api/review/status');
}
