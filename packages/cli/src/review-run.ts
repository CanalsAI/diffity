import { getSessionById } from './session.js';
import { hasAgentGeneralThreadSince } from './threads.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getRepoRoot, resolveDiffArgs } from '@diffity/git';
import { agentCommand, DELEGATION_NOTE, generalNoteAsSystem, sendToMainAgent } from './main-agent.js';

const REVIEW_TIMEOUT_MS = 30 * 60_000;

let startedAt: number | null = null;
let reviewSessionId: string | null = null;

// The review is done once the agent posts its summary as a new general comment (the
// last step of the prompt below), or when it times out.
export function isReviewRunning(): boolean {
  if (startedAt === null) {
    return false;
  }
  const summaryPosted = !!reviewSessionId && hasAgentGeneralThreadSince(reviewSessionId, new Date(startedAt).toISOString());
  if (summaryPosted || Date.now() - startedAt > REVIEW_TIMEOUT_MS) {
    startedAt = null;
  }
  return startedAt !== null;
}

// What to review: a pull request (by URL) or the diff this session is showing.
export type ReviewTarget = { prUrl: string } | { prUrl?: undefined };

// Where the review skills live. They are user-invocation only, so neither the Skill tool
// nor a subagent can run them by name; the prompt has the agent read the SKILL.md and
// follow its steps instead. DIFFITY_REVIEW_SKILL points at another SKILL.md.
const SKILLS_DIR = join(homedir(), 'repositories', 'skills', 'skills');
const PR_REVIEW_SKILL = join(SKILLS_DIR, 'review-pr', 'SKILL.md');
const LOCAL_REVIEW_SKILL = join(SKILLS_DIR, 'review-local-changes', 'SKILL.md');

function buildPrompt(target: ReviewTarget, sessionId: string): string {
  const cli = agentCommand(sessionId);
  const root = getRepoRoot();
  const skill = (target.prUrl && process.env.DIFFITY_REVIEW_SKILL?.trim()) || (target.prUrl ? PR_REVIEW_SKILL : LOCAL_REVIEW_SKILL);
  const opening = target.prUrl
    ? [
        `Review the pull request ${target.prUrl}, checked out at ${root}.`,
      ]
    : [
        `Review the changes the diffity review UI is showing for the repository at ${root}: \`git diff ${resolveDiffArgs(getSessionById(sessionId)?.ref ?? 'work').args.join(' ')}\` run there (plus untracked files).`,
      ];
  return [
    DELEGATION_NOTE,
    '',
    ...opening,
    '',
    `Follow the review procedure in ${skill}: read that file and carry out its steps yourself (inspect, review independently, validate). It is a user-invocation-only skill, so do not try to start it with the Skill tool or a slash command; if it is not at that path, say so in the summary and fall back to the built-in /code-review skill.`,
    "Delivery override for this run, taking precedence over the skill's own delivery steps:",
    '- Do not post anything to GitHub and do not wait for approval; the reviewer will edit your drafts in the review UI.'
    + (target.prUrl ? ' They submit them to the PR from there.' : ''),
    `- Record each validated finding as a draft with: ${cli} comment --file <path> --line <n> [--end-line <n>] [--side new|old] --body "<comment text>"`,
    '  Write each body as the exact comment a reviewer would post: one or two sentences, specific, no severity tags. Only anchor to lines in the diff.',
    `- When done, post a short markdown summary (findings count, anything you could not verify) with: ${cli} general-comment --body "<summary>". This is the last command you run, even if there are no findings.`,
  ].join('\n');
}

export function startReview(target: ReviewTarget, sessionId: string): void {
  startedAt = Date.now();
  reviewSessionId = sessionId;
  sendToMainAgent(buildPrompt(target, sessionId)).then((failure) => {
    if (failure) {
      startedAt = null;
      generalNoteAsSystem(sessionId, `**Couldn't start the review:** ${failure}`);
    }
  });
}
