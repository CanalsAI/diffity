import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { GitHubIcon } from '../icons/github-icon';
import { XIcon } from '../icons/x-icon';
import { Spinner } from '../icons/spinner';
import { submitGitHubReview, toPrCommentPayload, type GitHubDetails, type ReviewEvent } from '../../lib/api';
import type { CommentActions } from '../../hooks/use-comment-actions';
import type { CommentThread } from '../comments/types';
import { isThreadResolved } from '../comments/types';
import { useModalEscape } from '../../hooks/use-modal-escape';
import { cn } from '../../lib/cn';

interface SubmitReviewDialogProps {
  details: GitHubDetails;
  threads: CommentThread[];
  commentActions: CommentActions;
  onClose: () => void;
}

const VERDICTS: { value: ReviewEvent; label: string; hint: string; dot: string; done: string }[] = [
  { value: 'COMMENT', label: 'Comment', hint: 'Feedback without a verdict', dot: 'bg-text-muted', done: 'Review posted' },
  { value: 'APPROVE', label: 'Approve', hint: 'Ready to merge', dot: 'bg-added', done: 'Approved' },
  { value: 'REQUEST_CHANGES', label: 'Request changes', hint: 'Must be addressed before merging', dot: 'bg-deleted', done: 'Changes requested' },
];

// A draft is a thread started here: by the reviewer ("You") or drafted by the
// review agent ("Agent"). Threads pulled from GitHub carry the commenters' logins.
// Agent replies inside a thread are Q&A answers, so only a draft the agent started
// contributes its first comment; a reviewer's own draft contributes all their comments.
function isLocalDraft(thread: CommentThread): boolean {
  const starter = thread.comments[0]?.author.name;
  return starter === 'You' || starter === 'Agent';
}

function userBody(thread: CommentThread): string {
  if (thread.comments[0]?.author.name === 'Agent') {
    return thread.comments[0].body;
  }
  return thread.comments
    .filter((c) => c.author.name === 'You')
    .map((c) => c.body)
    .join('\n\n');
}

export function SubmitReviewDialog(props: SubmitReviewDialogProps) {
  const { details, threads, commentActions, onClose } = props;
  const [summary, setSummary] = useState('');
  const [event, setEvent] = useState<ReviewEvent>('COMMENT');
  // GitHub rejects approvals and change requests from a PR's own author.
  const { isOwnPr } = details;
  const [submitting, setSubmitting] = useState(false);
  useModalEscape(onClose);

  const drafts = useMemo(() => threads.filter(
    (t) => !isThreadResolved(t) && !t.filePath.startsWith('__') && isLocalDraft(t) && userBody(t),
  ), [threads]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(drafts.map((t) => t.id)));
  const chosen = drafts.filter((t) => selected.has(t.id));

  const nothingToSend = event !== 'APPROVE' && !summary.trim() && chosen.length === 0;
  const verdict = VERDICTS.find((v) => v.value === event) ?? VERDICTS[0];
  const submitLabel = event !== 'COMMENT'
    ? verdict.label
    : chosen.length > 0 ? `Post ${chosen.length} comment${chosen.length !== 1 ? 's' : ''}` : 'Post review';

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const comments = chosen.map((t) => toPrCommentPayload(t, userBody(t)));
      const result = await submitGitHubReview(event, summary.trim(), comments);
      // Drafts that reached GitHub (or were already there) are done locally.
      chosen.forEach((t) => commentActions.resolveThread(t.id));
      toast.success(`${verdict.done} on #${details.prNumber}`, {
        description: result.posted > 0 ? `${result.posted} inline comment${result.posted !== 1 ? 's' : ''} posted` : undefined,
        action: result.url ? { label: 'View', onClick: () => window.open(result.url!, '_blank') } : undefined,
      });
      onClose();
    } catch (err) {
      toast.error('Failed to submit review', { description: err instanceof Error ? err.message : 'Unknown error' });
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-16" onClick={onClose}>
      <div className="bg-bg rounded-xl shadow-lg w-full max-w-md mx-4 font-sans max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between px-4 pt-4 pb-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-text">Submit review · #{details.prNumber}</div>
            <div className="text-[11px] text-text-muted truncate">{details.prTitle}</div>
          </div>
          <button onClick={onClose} className="p-1 rounded-md text-text-muted hover:text-text hover:bg-hover cursor-pointer shrink-0">
            <XIcon className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="px-4 pb-3 space-y-3 overflow-y-auto">
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Summary (optional)"
            rows={3}
            className="w-full px-3 py-2 text-sm bg-bg-secondary border border-border rounded-md text-text resize-y outline-none placeholder:text-text-muted"
          />

          {drafts.length > 0 ? (
            <div className="rounded-md border border-border divide-y divide-border max-h-48 overflow-y-auto">
              {drafts.map((t) => (
                <label key={t.id} className="flex gap-2 px-3 py-2 cursor-pointer hover:bg-hover">
                  <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} className="mt-0.5" />
                  <div className="min-w-0">
                    <div className="text-[11px] font-mono text-text-muted truncate">
                      {t.filePath}:{t.startLine === t.endLine ? t.startLine : `${t.startLine}-${t.endLine}`}
                    </div>
                    <div className="text-xs text-text line-clamp-2">{userBody(t)}</div>
                  </div>
                </label>
              ))}
            </div>
          ) : (
            <div className="text-xs text-text-muted px-1">No draft inline comments. Add some in the diff, then submit.</div>
          )}

          <div className="rounded-md border border-border p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-text mb-2">
              <GitHubIcon className="w-4 h-4" />
              Post to GitHub
            </div>
            <div className="space-y-1.5">
              {VERDICTS.map((v) => (
                <label
                  key={v.value}
                  className={cn('flex items-center gap-2 text-xs', isOwnPr && v.value !== 'COMMENT' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer')}
                >
                  <input
                    type="radio"
                    name="verdict"
                    checked={event === v.value}
                    disabled={isOwnPr && v.value !== 'COMMENT'}
                    onChange={() => setEvent(v.value)}
                  />
                  <span className={cn('w-2 h-2 rounded-full', v.dot)} />
                  <span className="font-medium text-text">{v.label}</span>
                  <span className="text-text-muted">{v.hint}</span>
                </label>
              ))}
            </div>
            {isOwnPr && (
              <div className="mt-2 text-[11px] text-text-muted">You opened this PR, so GitHub only allows comments.</div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-medium rounded-md text-text-secondary hover:bg-hover cursor-pointer">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || nothingToSend}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-accent text-white hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {submitting && <Spinner />}
            {submitLabel} to #{details.prNumber}
          </button>
        </div>
      </div>
    </div>
  );
}
