import { useRef, useEffect } from 'react';
import { useCommentDraftState } from './comment-drafts';

interface CommentFormProps {
  onSubmit: (body: string) => void;
  onCancel: () => void;
  placeholder?: string;
  submitLabel?: string;
  autoFocus?: boolean;
  lineLabel?: string;
  draftKey?: string;
}

export function CommentForm(props: CommentFormProps) {
  const { onSubmit, onCancel, placeholder = 'Leave a comment', submitLabel = 'Comment', autoFocus = true, lineLabel, draftKey } = props;
  const [draft, setDraft, restored] = useCommentDraftState<{ body: string } | null>(draftKey, null);
  const body = draft?.body ?? '';
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setDraft((previous) => previous ?? { body: '' });
  }, [setDraft]);

  useEffect(() => {
    if (autoFocus && !restored && textareaRef.current) {
      textareaRef.current.focus({ preventScroll: true });
    }
  }, [autoFocus, restored]);

  const handleCancel = () => {
    setDraft(null);
    onCancel();
  };

  const handleSubmit = () => {
    const trimmed = body.trim();
    if (!trimmed) {
      return;
    }
    onSubmit(trimmed);
    setDraft(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  };

  return (
    <div className="rounded-lg overflow-hidden bg-bg-tertiary pt-2">
      {lineLabel && (
        <div className="px-3 pb-1.5 -mt-0.5">
          <span className="text-xs text-text-secondary font-medium">{lineLabel}</span>
        </div>
      )}
      <div className="mx-1.5 mb-0.5 rounded-md overflow-hidden">
        <textarea
          ref={textareaRef}
          value={body}
          onChange={(e) => setDraft({ body: e.target.value })}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={3}
          className="w-full px-3 py-2 text-sm bg-bg text-text resize-y outline-none placeholder:text-text-muted min-h-[80px]"
        />
      </div>
      <div className="flex items-center gap-2 px-1.5 pb-1.5">
        <div className="flex-1" />
        <button
          onClick={handleCancel}
          className="px-3 py-1.5 text-xs font-medium rounded-md text-text-secondary hover:bg-hover transition-colors cursor-pointer"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!body.trim()}
          className="px-3 py-1.5 text-xs font-medium rounded-md bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
