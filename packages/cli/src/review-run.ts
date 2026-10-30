import { getCurrentSession } from './session.js';
import { hasAgentGeneralThreadSince } from './threads.js';
import { getRepoRoot, resolveDiffArgs } from '@diffity/git';
import { agentCommand, DELEGATION_NOTE, generalNoteAsSystem, sendToMainAgent } from './main-agent.js';

const REVIEW_TIMEOUT_MS = 30 * 60_000;
const DEFAULT_PR_REVIEW_COMMAND = '/canals:review-pr';
const LOCAL_REVIEW_COMMAND = '/canals:review-local-changes';

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

// What to review: a pull request (by URL) or the diff this session is showing.
export type ReviewTarget = { prUrl: string } | { prUrl?: undefined };

function buildPrompt(target: ReviewTarget): string {
  const cli = agentCommand();
  const root = getRepoRoot();
  const opening = target.prUrl
    ? [
        `Run ${process.env.DIFFITY_REVIEW_COMMAND?.trim() || DEFAULT_PR_REVIEW_COMMAND} ${target.prUrl}`,
        '',
        `Review the pull request checked out at ${root}.`,
      ]
    : [
        `Run ${LOCAL_REVIEW_COMMAND}`,
        '',
        `Review the changes the diffity review UI is showing for the repository at ${root}: \`git diff ${resolveDiffArgs(getCurrentSession()?.ref ?? 'work').args.join(' ')}\` run there (plus untracked files).`,
      ];
  return [
    DELEGATION_NOTE,
    '',
    ...opening,
    "Delivery override for this run, taking precedence over the skill's own delivery steps:",
    '- Do not post anything to GitHub and do not wait for approval; the reviewer will edit your drafts in the review UI.'
    + (target.prUrl ? ' They submit them to the PR from there.' : ''),
    `- Record each validated finding as a draft with: ${cli} comment --file <path> --line <n> [--end-line <n>] [--side new|old] --body "<comment text>"`,
    '  Write each body as the exact comment a reviewer would post: one or two sentences, specific, no severity tags. Only anchor to lines in the diff.',
    `- When done, post a short markdown summary (findings count, anything you could not verify) with: ${cli} general-comment --body "<summary>"`,
  ].join('\n');
}

export function startReview(target: ReviewTarget): void {
  startedAt = Date.now();
  sendToMainAgent(buildPrompt(target)).then((failure) => {
    if (failure) {
      startedAt = null;
      generalNoteAsSystem(`**Couldn't start the review:** ${failure}`);
    }
  });
}
