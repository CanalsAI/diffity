import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useLoaderData } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useDiff } from '../../hooks/use-diff';
import { useInfo } from '../../hooks/use-info';
import { useTheme } from '../../hooks/use-theme';
import { useAutoCollapse } from '../../hooks/use-auto-collapse';
import { useKeyboard } from '../../hooks/use-keyboard';
import { useReviewThreads } from '../../hooks/use-review-threads';
import { useViewedFiles } from '../../hooks/use-viewed-files';
import { useCommentActions } from '../../hooks/use-comment-actions';
import { Toolbar } from '../layout/toolbar';
import { DiffView, type DiffViewHandle } from './diff-view';
import { Sidebar } from '../layout/sidebar';
import { ShortcutModal } from '../layout/shortcut-modal';
import { StaleDiffBanner } from '../layout/stale-diff-banner';
import { CheckCircleIcon } from '../icons/check-circle-icon';
import { PageLoader } from '../layout/skeleton';
import { useDiffStaleness } from '../../hooks/use-diff-staleness';
import { type ViewMode, getFilePath, getAutoCollapsedPaths } from '../../lib/diff-utils';
import { sortFilesByTree } from '../../lib/file-tree';
import { buildFirstOpenThreadByFile, buildThreadCountsByFile } from '../../lib/comment-navigation';
import { getHunkHeaders, scrollToElement } from '../../lib/dom-utils';
import { findMatches } from '../../lib/diff-search';
import { fetchGitHubDetails, markFileViewed, unmarkFileViewed, type GitHubDetails } from '../../lib/api';
import type { LineSelection } from '../comments/types';
import { isThreadResolved } from '../comments/types';

export function DiffPage() {
  const { ref: refParam, theme: initialTheme, view: initialViewMode } = useLoaderData<{
    ref: string;
    theme: 'light' | 'dark' | null;
    view: 'split' | 'unified' | null;
  }>();

  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode || 'split');
  const [hideWhitespace, setHideWhitespace] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const { theme, toggleTheme } = useTheme(initialTheme);
  const { autoCollapse, toggleAutoCollapse } = useAutoCollapse();
  const { data: rawDiff, error } = useDiff(hideWhitespace, refParam);
  const diff = useMemo(() => {
    if (!rawDiff) {
      return rawDiff;
    }
    return { ...rawDiff, files: sortFilesByTree(rawDiff.files) };
  }, [rawDiff]);
  const { data: info } = useInfo(refParam);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [reviewedFiles, setReviewedFiles] = useState<Set<string>>(new Set());
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const manuallyToggledRef = useRef<Set<string>>(new Set());
  const prevFilesWithCommentsRef = useRef<Set<string>>(new Set());
  const hasSeededCommentsRef = useRef(false);
  const [pendingSelection, setPendingSelection] = useState<LineSelection | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const diffViewRef = useRef<DiffViewHandle>(null);
  const currentFileIdx = useRef(0);
  const initializedDiffRef = useRef<typeof diff>(null);
  const initializedAutoCollapseRef = useRef<boolean | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState(-1);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearchQuery(searchQuery), 150);
    return () => clearTimeout(id);
  }, [searchQuery]);

  const reviewsEnabled = !!info?.capabilities?.reviews;
  const sessionId = info?.sessionId ?? null;
  const canRevert = !!info?.capabilities?.revert;
  const { isStale, resetStaleness } = useDiffStaleness(refParam, !!info?.capabilities?.staleness);
  const [githubDetails, setGithubDetails] = useState<GitHubDetails | null>(null);

  useEffect(() => {
    if (!info?.github) {
      return;
    }
    fetchGitHubDetails()
      .then(data => setGithubDetails(data))
      .catch(() => {});
  }, [info?.github]);

  const { data: serverViewed } = useViewedFiles(refParam);
  const { data: serverThreads, isFetched: threadsFetched } = useReviewThreads(reviewsEnabled ? sessionId : null);
  const threads = reviewsEnabled && serverThreads ? serverThreads : [];
  const commentActions = useCommentActions(sessionId, reviewsEnabled);
  const commentCountsByFile = useMemo(() => buildThreadCountsByFile(threads), [threads]);

  const filesWithComments = useMemo(() => {
    return new Set(commentCountsByFile.keys());
  }, [commentCountsByFile]);

  const firstOpenThreadByFile = useMemo(() => {
    const fileOrder = diff?.files.map(file => getFilePath(file)) ?? [];
    return buildFirstOpenThreadByFile(threads, fileOrder);
  }, [diff, threads]);

  const handleAddThread = useCallback((...args: Parameters<typeof commentActions.addThread>) => {
    commentActions.addThread(...args);
    setPendingSelection(null);
  }, [commentActions]);

  useEffect(() => {
    if (!diff) {
      return;
    }
    if (diff === initializedDiffRef.current && autoCollapse === initializedAutoCollapseRef.current) {
      return;
    }
    initializedDiffRef.current = diff;
    initializedAutoCollapseRef.current = autoCollapse;

    const autoCollapsed = autoCollapse ? getAutoCollapsedPaths(diff.files) : new Set<string>();
    for (const path of filesWithComments) {
      autoCollapsed.delete(path);
    }
    for (const path of manuallyToggledRef.current) {
      if (autoCollapsed.has(path)) {
        autoCollapsed.delete(path);
      } else {
        autoCollapsed.add(path);
      }
    }
    setCollapsedFiles(autoCollapsed);
  }, [diff, autoCollapse]);

  useEffect(() => {
    if (!serverViewed) {
      return;
    }
    setReviewedFiles(new Set(serverViewed));
    if (serverViewed.length > 0) {
      setCollapsedFiles((prev) => {
        const next = new Set(prev);
        for (const path of serverViewed) {
          next.add(path);
        }
        return next;
      });
    }
  }, [serverViewed]);

  useEffect(() => {
    // Expand a file to surface its comments only when it *newly* enters the
    // commented set — never re-expand every commented file on each change, so
    // commenting on one file doesn't re-open others the user had collapsed.
    //
    // Viewed files are the wrinkle. Comments that already existed when the diff
    // first loaded must not pop open a file the user marked viewed (that's what
    // "viewed" means, and it must hold whichever of the viewed/threads queries
    // resolves first). But a comment that *arrives* later — e.g. from an AI
    // review dropping feedback while you watch — should re-surface its file even
    // if viewed. So skip viewed files only on the initial seed of the set.
    const prev = prevFilesWithCommentsRef.current;
    const initialSeed = !hasSeededCommentsRef.current;
    const newlyCommented: string[] = [];
    for (const path of filesWithComments) {
      if (prev.has(path)) {
        continue;
      }
      if (initialSeed && reviewedFiles.has(path)) {
        continue;
      }
      newlyCommented.push(path);
    }
    prevFilesWithCommentsRef.current = filesWithComments;
    if (threadsFetched) {
      hasSeededCommentsRef.current = true;
    }
    if (newlyCommented.length === 0) {
      return;
    }
    setCollapsedFiles((prevCollapsed) => {
      let changed = false;
      const next = new Set(prevCollapsed);
      for (const path of newlyCommented) {
        if (next.has(path)) {
          next.delete(path);
          changed = true;
        }
      }
      return changed ? next : prevCollapsed;
    });
  }, [filesWithComments, reviewedFiles, threadsFetched]);

  const handleToggleCollapse = useCallback((path: string) => {
    const toggled = manuallyToggledRef.current;
    if (toggled.has(path)) {
      toggled.delete(path);
    } else {
      toggled.add(path);
    }
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleReviewedChange = useCallback((path: string, reviewed: boolean, reanchor = true) => {
    setReviewedFiles((prev) => {
      const next = new Set(prev);
      if (reviewed) {
        next.add(path);
      } else {
        next.delete(path);
      }
      return next;
    });
    const persist = reviewed ? markFileViewed : unmarkFileViewed;
    persist(path, refParam).catch(() => {});
    if (reviewed) {
      // Collapsing a file removes its body height. The virtualizer compensates
      // by subtracting the whole removed height from the scroll offset — even
      // the part that was below the fold — which yanks the view upward (a big
      // jump for a large file). Capture the file's top before collapsing and
      // pin the scroll to it so the collapsed header stays put at the top.
      const container = mainRef.current;
      let pinTop: number | null = null;
      if (reanchor && container) {
        const fileEl = container.ownerDocument.getElementById(`file-${encodeURIComponent(path)}`);
        if (fileEl) {
          const offsetFromTop = fileEl.getBoundingClientRect().top - container.getBoundingClientRect().top;
          // Only pin when the file extends above the viewport top — that's the
          // case where collapsing yanks the view upward. A file sitting fully
          // below the top collapses in place with no jump, so leave it alone.
          if (offsetFromTop <= 0) {
            pinTop = Math.max(0, container.scrollTop + offsetFromTop);
          }
        }
      }
      setCollapsedFiles((prev) => {
        const next = new Set(prev);
        next.add(path);
        return next;
      });
      if (container && pinTop !== null) {
        const target = pinTop;
        // The over-compensation is always upward (below target), so only correct
        // upward drift — this leaves the user free to scroll down immediately.
        const pin = () => { if (container.scrollTop < target) container.scrollTop = target; };
        // The virtualizer compensates for the collapsed height by scrolling up.
        // Snap back on that scroll event (fired before paint) to avoid a visible
        // flash, and re-assert over the next frames as a safety net.
        const onScroll = () => pin();
        container.addEventListener('scroll', onScroll);
        pin();
        requestAnimationFrame(() => { pin(); requestAnimationFrame(pin); });
        setTimeout(() => {
          pin();
          container.removeEventListener('scroll', onScroll);
        }, 200);
      }
    } else {
      setCollapsedFiles((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    }
  }, [refParam]);

  const handleReviewedChangeMany = useCallback((paths: string[], reviewed: boolean) => {
    if (paths.length === 0) {
      return;
    }
    setReviewedFiles((prev) => {
      const next = new Set(prev);
      for (const path of paths) {
        if (reviewed) {
          next.add(path);
        } else {
          next.delete(path);
        }
      }
      return next;
    });
    const persist = reviewed ? markFileViewed : unmarkFileViewed;
    for (const path of paths) {
      persist(path, refParam).catch(() => {});
    }
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      for (const path of paths) {
        if (reviewed) {
          next.add(path);
        } else {
          next.delete(path);
        }
      }
      return next;
    });
  }, [refParam]);

  const getCurrentFilePath = useCallback((): string | null => {
    if (!diff) {
      return null;
    }
    return getFilePath(diff.files[currentFileIdx.current]);
  }, [diff]);

  const navigateFile = useCallback((direction: number) => {
    if (!diff) {
      return;
    }
    const nextIdx = Math.max(0, Math.min(diff.files.length - 1, currentFileIdx.current + direction));
    currentFileIdx.current = nextIdx;
    const path = getFilePath(diff.files[nextIdx]);
    diffViewRef.current?.scrollToFile(path);
  }, [diff]);

  const navigateHunk = useCallback((direction: number) => {
    const hunks = getHunkHeaders();
    if (hunks.length === 0) {
      return;
    }
    let target = direction > 0 ? hunks[0] : hunks[hunks.length - 1];

    for (let i = 0; i < hunks.length; i++) {
      const rect = hunks[i].getBoundingClientRect();
      if (direction > 0 && rect.top > 100) {
        target = hunks[i];
        break;
      }
      if (direction < 0 && rect.top < -10) {
        target = hunks[i];
      }
    }

    scrollToElement(target);
  }, []);

  const searchMatches = useMemo(() => {
    if (!diff || debouncedSearchQuery.length === 0) {
      return [];
    }
    return findMatches(diff.files, debouncedSearchQuery);
  }, [diff, debouncedSearchQuery]);

  useEffect(() => {
    setSearchIndex(searchMatches.length > 0 ? 0 : -1);
  }, [searchMatches]);

  const currentMatch = searchIndex >= 0 ? searchMatches[searchIndex] : undefined;
  const currentMatchId = currentMatch?.id ?? null;
  const searchExpandFile = currentMatch?.filePath ?? null;

  useEffect(() => {
    if (!currentMatch) {
      return;
    }
    setCollapsedFiles((prev) => {
      if (!prev.has(currentMatch.filePath)) {
        return prev;
      }
      const next = new Set(prev);
      next.delete(currentMatch.filePath);
      return next;
    });
    const frame = requestAnimationFrame(() => {
      diffViewRef.current?.scrollToLine(currentMatch.fileIndex, currentMatch.lineKey);
    });
    return () => cancelAnimationFrame(frame);
  }, [currentMatchId]);

  const focusDiffSearch = useCallback(() => {
    const input = document.querySelector(
      'input[placeholder="Search changes..."]',
    ) as HTMLInputElement | null;
    if (!input) {
      return;
    }
    input.focus();
    input.select();
    const selection = window.getSelection?.()?.toString().trim();
    if (selection && !selection.includes('\n') && selection.length <= 100) {
      setSearchQuery(selection);
    }
  }, []);

  const goToNextMatch = useCallback(() => {
    setSearchIndex((i) => (searchMatches.length === 0 ? -1 : (i + 1) % searchMatches.length));
  }, [searchMatches.length]);

  const goToPrevMatch = useCallback(() => {
    setSearchIndex((i) => (searchMatches.length === 0 ? -1 : (i - 1 + searchMatches.length) % searchMatches.length));
  }, [searchMatches.length]);

  useKeyboard({
    onNextFile: () => navigateFile(1),
    onPrevFile: () => navigateFile(-1),
    onNextHunk: () => navigateHunk(1),
    onPrevHunk: () => navigateHunk(-1),
    onToggleCollapse: () => {
      const path = getCurrentFilePath();
      if (path) {
        handleToggleCollapse(path);
      }
    },
    onCollapseAll: () => {
      if (!diff) {
        return;
      }
      const allPaths = diff.files.map((f) => getFilePath(f));
      const anyExpanded = allPaths.some((p) => !collapsedFiles.has(p));
      manuallyToggledRef.current = new Set();
      if (anyExpanded) {
        setCollapsedFiles(new Set(allPaths));
      } else {
        setCollapsedFiles(new Set());
      }
    },
    onToggleReviewed: () => {
      const path = getCurrentFilePath();
      if (!path) {
        return;
      }
      const wasReviewed = reviewedFiles.has(path);
      handleReviewedChange(path, !wasReviewed, false);
      if (!wasReviewed) {
        navigateFile(1);
      }
    },
    onUnifiedView: () => setViewMode('unified'),
    onSplitView: () => setViewMode('split'),
    onShowHelp: () => setShowHelp(true),
    onFocusSearch: () => {
      const input = document.querySelector(
        'input[placeholder="Filter files..."]',
      ) as HTMLInputElement;
      if (input) {
        input.focus();
      }
    },
    onFindInDiff: focusDiffSearch,
    onEscape: () => setShowHelp(false),
  });

  const queryClient = useQueryClient();

  const handleRevert = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['diff'] });
    queryClient.invalidateQueries({ queryKey: ['viewed'] });
  }, [queryClient]);

  const handleRefreshDiff = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['diff'] });
    queryClient.invalidateQueries({ queryKey: ['viewed'] });
    resetStaleness();
  }, [queryClient, resetStaleness]);

  const handleSidebarFileClick = useCallback((path: string) => {
    setActiveFile(path);
    diffViewRef.current?.scrollToFile(path);
  }, []);

  const handleScrollToThread = useCallback((threadId: string, filePath: string) => {
    setActiveFile(filePath);
    setCollapsedFiles((prev) => {
      if (!prev.has(filePath)) {
        return prev;
      }
      const next = new Set(prev);
      next.delete(filePath);
      return next;
    });
    diffViewRef.current?.scrollToThread(threadId, filePath);
  }, []);

  const handleSidebarCommentedFileClick = useCallback((path: string) => {
    const threadId = firstOpenThreadByFile.get(path);
    if (!threadId) {
      handleSidebarFileClick(path);
      return;
    }
    handleScrollToThread(threadId, path);
  }, [firstOpenThreadByFile, handleSidebarFileClick, handleScrollToThread]);

  const handleActiveFileFromScroll = useCallback((path: string) => {
    setActiveFile(path);
  }, []);

  if (error) {
    return (
      <div className="flex flex-col min-h-screen bg-bg text-text font-sans">
        <div className="flex flex-col items-center justify-center p-12 text-deleted text-center">
          <h2 className="text-xl mb-2">Failed to load diff</h2>
          <p className="text-text-secondary">{error}</p>
        </div>
      </div>
    );
  }

  const threadsLoading = reviewsEnabled && !threadsFetched;
  if (threadsLoading) {
    return <PageLoader />;
  }

  if (diff.files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-bg text-text font-sans gap-2">
        <div className="text-added opacity-40 mb-1">
          <CheckCircleIcon />
        </div>
        <h2 className="text-base font-medium text-text-secondary">No changes found</h2>
        <p className="text-xs text-text-muted">There are no differences to display.</p>
        <div className="mt-4 flex flex-col gap-1.5 items-center">
          <p className="text-xs text-text-muted mb-1">Try one of these</p>
          <code className="inline-block px-3 py-1 bg-bg-secondary border border-border rounded-md font-mono text-xs text-text">
            diffity HEAD~1
          </code>
          <code className="inline-block px-3 py-1 bg-bg-secondary border border-border rounded-md font-mono text-xs text-text">
            diffity main..feature
          </code>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-bg text-text font-sans">
      <Toolbar
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        hideWhitespace={hideWhitespace}
        onHideWhitespaceChange={setHideWhitespace}
        theme={theme}
        onToggleTheme={toggleTheme}
        autoCollapse={autoCollapse}
        onToggleAutoCollapse={toggleAutoCollapse}
        onShowHelp={() => setShowHelp(true)}
        diff={diff || undefined}
        diffRef={refParam}
        threads={threads}
        onDeleteAllComments={commentActions.deleteAllThreads}
        onScrollToThread={handleScrollToThread}
        repoName={info?.name || null}
        branch={info?.branch || null}
        description={info?.description || null}
        githubDetails={githubDetails}
        sessionId={sessionId}
        onGitHubPulled={() => queryClient.invalidateQueries({ queryKey: ['threads'] })}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        searchMatchCount={searchMatches.length}
        searchCurrentIndex={searchIndex}
        onSearchNext={goToNextMatch}
        onSearchPrev={goToPrevMatch}
      />
      {isStale && <StaleDiffBanner onRefresh={handleRefreshDiff} />}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          files={diff?.files || []}
          activeFile={activeFile}
          reviewedFiles={reviewedFiles}
          commentCountsByFile={commentCountsByFile}
          onFileClick={handleSidebarFileClick}
          onCommentedFileClick={handleSidebarCommentedFileClick}
          onReviewedChangeMany={handleReviewedChangeMany}
        />
        {diff ? (
          <DiffView
            diff={diff}
            viewMode={viewMode}
            theme={theme}
            collapsedFiles={collapsedFiles}
            onToggleCollapse={handleToggleCollapse}
            reviewedFiles={reviewedFiles}
            onReviewedChange={handleReviewedChange}
            onActiveFileChange={handleActiveFileFromScroll}
            handle={diffViewRef}
            baseRef={refParam}
            canRevert={canRevert}
            onRevert={handleRevert}
            scrollRef={(node) => {
              mainRef.current = node;
            }}
            threads={threads}
            commentsEnabled={reviewsEnabled}
            commentActions={commentActions}
            onAddThread={handleAddThread}
            pendingSelection={pendingSelection}
            onPendingSelectionChange={setPendingSelection}
            searchMatches={searchMatches}
            currentSearchMatchId={currentMatchId}
            searchActive={debouncedSearchQuery.length > 0}
            searchExpandFile={searchExpandFile}
          />
        ) : null}
      </div>
      {showHelp && <ShortcutModal onClose={() => setShowHelp(false)} />}
    </div>
  );
}
