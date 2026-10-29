import { getCurrentSession } from './session.js';
import { hasAgentGeneralThreadSince } from './threads.js';
import { getRepoRoot } from '@diffity/git';
import { agentCommand, generalNoteAsSystem, sendToMainAgent } from './main-agent.js';

const REVIEW_TIMEOUT_MS = 30 * 60_000;
const DEFAULT_REVIEW_COMMAND = '/canals:review-pr';

let startedAt: number | null = null;

// The review is done once the agent posts its summary as a new general comment (the
// last step of the prompt below), or when it times out.
export function isReviewRunning(): boolean {
  if (startedAt === null) {
    return false;
  }
  const session = getCurrentSession();
  const summaryPosted = !!session && hasAgentGeneralThreadSince(session.id, new Date(startedAt).toISOString());
  if (summaryPosted || Date.now() - startedAt > REVIEW_TIMEOUT_MS) {
    startedAt = null;
  }
  return startedAt !== null;
}

function buildPrompt(prUrl: string): string {
  const command = process.env.DIFFITY_REVIEW_COMMAND?.trim() || DEFAULT_REVIEW_COMMAND;
  const cli = agentCommand();
  return [
    `${command} ${prUrl}`,
    '',
    `[Diffity review] Review the pull request checked out at ${getRepoRoot()}. Delivery override for this run, taking precedence over the skill's own delivery steps:`,
    '- Do not post anything to GitHub and do not wait for approval; the reviewer will edit your drafts in the review UI and submit them.',
    `- Record each validated finding as a draft with: ${cli} comment --file <path> --line <n> [--end-line <n>] [--side new|old] --body "<comment text>"`,
    '  Write each body as the exact comment a reviewer would post: one or two sentences, specific, no severity tags. Only anchor to lines in the PR diff.',
    `- When done, post a short markdown summary (findings count, anything you could not verify) with: ${cli} general-comment --body "<summary>"`,
  ].join('\n');
}

export function startReview(prUrl: string): void {
  startedAt = Date.now();
  sendToMainAgent(buildPrompt(prUrl)).then((failure) => {
    if (failure) {
      startedAt = null;
      generalNoteAsSystem(`**Couldn't start the review:** ${failure}`);
    }
  });
}
