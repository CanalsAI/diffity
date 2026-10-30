import type { IncomingMessage, ServerResponse } from 'node:http';
import { getRepoRoot, resolveDiffArgs } from '@diffity/git';
import { getThread, type Thread } from './threads.js';
import { getSessionById } from './session.js';
import { sendJson, sendError } from './http-utils.js';
import { agentCommand, DELEGATION_NOTE, describePr, replyAsSystem, sendToMainAgent } from './main-agent.js';

const ASK_TIMEOUT_MS = 20 * 60_000;

interface PendingAsk {
  startedAt: number;
  commentCount: number;
}

const pending = new Map<string, PendingAsk>();

// A question is pending until the agent's reply lands in the thread (it writes it
// itself with `diffity agent reply`), or it times out.
function pendingThreadIds(): string[] {
  for (const [id, ask] of pending) {
    const thread = getThread(id);
    const last = thread?.comments[thread.comments.length - 1];
    const answered = !!thread && thread.comments.length > ask.commentCount && last?.author.type === 'agent';
    if (!thread || answered || Date.now() - ask.startedAt > ASK_TIMEOUT_MS) {
      pending.delete(id);
    }
  }
  return Array.from(pending.keys());
}

function locationLabel(thread: Thread): string {
  if (thread.filePath === '__general__') {
    return 'General comment on the whole change';
  }
  const lines = thread.startLine === thread.endLine ? `${thread.startLine}` : `${thread.startLine}-${thread.endLine}`;
  return `${thread.filePath}:${lines} (${thread.side === 'old' ? 'before the change' : 'after the change'})`;
}

function describeThread(thread: Thread): string {
  const where = locationLabel(thread);
  const code = thread.anchorContent ? `\nCode:\n${thread.anchorContent}\n` : '';
  const conversation = thread.comments
    .map((c) => `${c.author.type === 'agent' ? 'Agent' : 'Reviewer'}: ${c.body}`)
    .join('\n\n');
  return `${where}${code}\nConversation:\n${conversation}`;
}

function buildPrompt(thread: Thread, ref: string): string {
  const diffArgs = resolveDiffArgs(ref).args.join(' ');
  return [
    DELEGATION_NOTE,
    '',
    `A reviewer asked a question on ${describePr()}. The code under review is checked out at ${getRepoRoot()}.`,
    `The change is \`git diff ${diffArgs}\` run in that directory. Investigate read-only: do not edit files, commit, or post anything to GitHub.`,
    '',
    describeThread(thread),
    '',
    "Answer the reviewer's latest message concisely in markdown, grounded in the code. If something is a real problem, say so plainly. Then record the answer in the review UI with:",
    `${agentCommand(thread.sessionId)} reply ${thread.id} --body "$(cat <<'EOF'`,
    '<your answer>',
    'EOF',
    ')"',
  ].join('\n');
}

// Fire-and-forget: the answer arrives as an agent reply on the thread.
export function startAsk(threadId: string): void {
  const thread = getThread(threadId);
  if (!thread || pendingThreadIds().includes(thread.id)) {
    return;
  }
  const sessionRef = getSessionById(thread.sessionId)?.ref;
  const ref = sessionRef && !sessionRef.startsWith('__') ? sessionRef : 'work';

  pending.set(thread.id, { startedAt: Date.now(), commentCount: thread.comments.length });
  sendToMainAgent(buildPrompt(thread, ref)).then((failure) => {
    if (failure) {
      replyAsSystem(thread.id, `**Couldn't ask your agent:** ${failure}`);
    }
  });
}

export function handleAskRoute(req: IncomingMessage, res: ServerResponse, pathname: string): boolean {
  if (pathname === '/api/ask/pending' && req.method === 'GET') {
    sendJson(res, { threadIds: pendingThreadIds() });
    return true;
  }

  const match = pathname.match(/^\/api\/threads\/([^/]+)\/ask$/);
  if (match && req.method === 'POST') {
    if (!getThread(match[1])) {
      sendError(res, 404, 'Thread not found');
      return true;
    }
    if (pendingThreadIds().includes(match[1])) {
      sendError(res, 409, 'Your agent is already answering this thread');
      return true;
    }
    startAsk(match[1]);
    sendJson(res, { ok: true });
    return true;
  }

  return false;
}
