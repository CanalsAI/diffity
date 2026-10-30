import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { getRepoRoot } from '@diffity/git';
import { prNumberFromCheckout } from '@diffity/github';
import { addReply, createThread } from './threads.js';

// Delivery goes through the workspace's own agent session (`devspaces agent
// send-message`), the same channel the Diff Viewer's Resolve and Ship It! buttons use.
const SEND_TIMEOUT_MS = 3 * 60_000;
const IDLE_SECS = 5;
const BUDGET_SECS = 120;

const SYSTEM_AUTHOR = { name: 'Diffity', type: 'agent' as const };

export function isMainAgentAvailable(): boolean {
  return (process.env.PATH ?? '').split(delimiter).some((dir) => dir && existsSync(join(dir, 'devspaces')));
}

// Replies and comments are written back through this instance's own `diffity agent`
// commands, run from the checkout so they resolve to this review session.
export function agentCommand(sessionId: string): string {
  return `cd ${shellQuote(getRepoRoot())} && node ${shellQuote(process.argv[1])} agent --session ${sessionId}`;
}

// Prepended to every message: the workspace agent receives these in the middle of its own
// work, so the job runs in a subagent and only a one-line acknowledgement lands in the
// agent's context.
export const DELEGATION_NOTE = '[Diffity review] Automated request from the diffity review UI. Do not do this work in your own context: hand the whole message below to a subagent (Agent tool), let it carry out every step including the diffity agent command at the end, then reply here with a single line saying it is done. Do not stop or change what you were doing otherwise.';

export function describePr(): string {
  const pr = prNumberFromCheckout();
  return pr ? `pull request #${pr}` : 'this change';
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// Resolves with null once the agent has the message (typed now, or queued behind a
// running turn), or a human-readable reason it didn't.
export function sendToMainAgent(text: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'devspaces',
      ['agent', 'send-message', '--wait-idle', '--idle-secs', String(IDLE_SECS), '--budget-secs', String(BUDGET_SECS), text],
      { timeout: SEND_TIMEOUT_MS },
      (err, stdout, stderr) => {
        const outcome = stdout.match(/send-message:\s*(\S+)/)?.[1];
        if (!err && (outcome === 'sent' || outcome === 'queued')) {
          resolve(null);
        } else if (outcome === 'skipped-no-session') {
          resolve('Your workspace agent is not running. Open its tab, then try again.');
        } else if (stderr.trim()) {
          resolve(stderr.trim());
        } else if (outcome) {
          resolve(`The workspace agent did not take the message (${outcome}).`);
        } else {
          resolve(err?.message ?? 'Unknown error');
        }
      },
    );
  });
}

export function replyAsSystem(threadId: string, body: string): void {
  addReply(threadId, body, SYSTEM_AUTHOR);
}

export function generalNoteAsSystem(sessionId: string, body: string): void {
  createThread(sessionId, '__general__', 'new', 0, 0, body, SYSTEM_AUTHOR);
}
