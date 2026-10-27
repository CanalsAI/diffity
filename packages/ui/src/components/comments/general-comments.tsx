import { useState, useRef, useEffect, useId } from 'react';
import { GENERAL_THREAD_FILE_PATH, isThreadResolved, DEFAULT_AUTHOR } from './types';
import type { CommentThread as CommentThreadType } from './types';
import type { CommentActions } from '../../hooks/use-comment-actions';
import { handleModalEscape } from '../../hooks/use-modal-escape';
import { CommentForm } from './comment-form';
import { CommentIcon } from '../icons/comment-icon';
import { ThreadBadge } from '../ui/thread-badge';
import { ThreadCard } from './thread-card';

interface GeneralCommentsProps {
  threads: CommentThreadType[];
  commentActions: CommentActions;
}

export function GeneralComments(props: GeneralCommentsProps) {
  const { threads: allThreads, commentActions } = props;

  const threads = allThreads.filter(t => t.filePath === GENERAL_THREAD_FILE_PATH);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!isExpanded) {
      return;
    }
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsExpanded(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      handleModalEscape(e, () => {
        setIsExpanded(false);
        buttonRef.current?.focus();
      });
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [isExpanded]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        ref={buttonRef}
        onClick={() => {
          setIsExpanded(!isExpanded);
          if (threads.length === 0) {
            setShowForm(true);
          }
        }}
        aria-expanded={isExpanded}
        aria-controls={panelId}
        className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-text-secondary bg-bg-tertiary rounded-md hover:bg-hover hover:text-text transition-colors cursor-pointer"
      >
        <CommentIcon className="w-3.5 h-3.5" />
        General comments
        {threads.length > 0 && (
          <span className="text-[11px] font-medium bg-accent/15 text-accent px-1.5 rounded-full">{threads.length}</span>
        )}
      </button>
      <div
        id={panelId}
        hidden={!isExpanded}
        role="region"
        aria-label="General comments"
        className="absolute right-0 top-full mt-2 w-[28rem] max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-5rem)] overflow-y-auto bg-bg border border-border rounded-lg shadow-lg z-50"
      >
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border">
          <span className="text-sm font-medium text-text">General comments</span>
          <button
            onClick={() => setShowForm(true)}
            className="text-xs text-accent hover:text-accent-hover transition-colors cursor-pointer"
          >
            Add comment
          </button>
        </div>
        <div>
          {showForm && (
            <div className="p-3">
              <CommentForm
                onSubmit={(body) => {
                  commentActions.addThread(GENERAL_THREAD_FILE_PATH, 'new', 0, 0, body, DEFAULT_AUTHOR);
                  setShowForm(false);
                }}
                onCancel={() => setShowForm(false)}
                placeholder="Leave a general comment..."
                submitLabel="Comment"
              />
            </div>
          )}
          {threads.length > 0 ? (
            <div className="p-3 space-y-3">
              {threads.map((thread, index) => (
                <ThreadCard
                  key={thread.id}
                  thread={thread}
                  onReply={(body) => commentActions.addReply(thread.id, body, DEFAULT_AUTHOR)}
                  onResolve={() => commentActions.resolveThread(thread.id)}
                  onUnresolve={() => commentActions.unresolveThread(thread.id)}
                  onEditComment={(commentId, body) => commentActions.editComment(commentId, body)}
                  onDeleteComment={(commentId) => commentActions.deleteComment(thread.id, commentId)}
                  onDeleteThread={() => commentActions.deleteThread(thread.id)}
                  className="bg-bg-secondary"
                  headerLeft={
                    <>
                      <span className="text-[11px] text-text-muted font-mono">Thread #{index + 1}</span>
                      {isThreadResolved(thread) && <ThreadBadge variant="resolved" />}
                    </>
                  }
                />
              ))}
            </div>
          ) : !showForm && (
            <div className="px-3 py-4 text-center text-xs text-text-muted">
              No general comments yet
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
