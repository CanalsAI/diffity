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
import { refreshDiffWithGate } from '../../lib/large-diff-gate';
import { toast } from 'sonner';
import { type ViewMode, getFilePath, getAutoCollapsedPaths } from '../../lib/diff-utils';
import { sortFilesByTree } from '../../lib/file-tree';
import { buildFirstOpenThreadByFile, buildThreadCountsByFile, getFilesCommentedSinceViewed } from '../../lib/comment-navigation';
import { getHunkHeaders, scrollToElement } from '../../lib/dom-utils';
import { findMatches, focusSearchInput } from '../../lib/diff-search';
import { requestHostClose, shouldRequestHostClose } from '../../lib/embedding';
import { fetchGitHubDetails, markFileViewed, unmarkFileViewed, type GitHubDetails } from '../../lib/api';
import type { LineSelection } from '../comments/types';
import { isThreadResolved } from '../comments/types';

export function DiffPage() {
  const { ref: refParam, view: initialViewMode } = useLoaderData<{
    ref: string;
    view: 'split' | 'unified' | null;
  }>();

  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode || 'split');
  const [hideWhitespace, setHideWhitespace] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const { theme, toggleTheme } = useTheme();
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
  const knownPathsRef = useRef<Set<string>>(new Set());
  const hasSeededCommentsRef = useRef(false);
  const [pendingSelection, setPendingSelection] = useState<LineSelection | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const diffViewRef = useRef<DiffViewHandle>(null);
  const currentFileIdx = useRef(0);
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
    const autoCollapseChanged = initializedAutoCollapseRef.current !== null && autoCollapse !== initializedAutoCollapseRef.current;
    initializedAutoCollapseRef.current = autoCollapse;

    // A reloaded diff (refresh, whitespace toggle) keeps the collapse state of
    // files the user has already seen; only files new to this page get the
    // default. Toggling auto-collapse re-applies it to generated files the user
    // hasn't touched or marked viewed.
    const autoCollapsible = getAutoCollapsedPaths(diff.files);
    const known = knownPathsRef.current;
    setCollapsedFiles((prev) => {
      const next = new Set<string>();
      for (const file of diff.files) {
        const path = getFilePath(file);
        const reapply = autoCollapseChanged && autoCollapsible.has(path)
          && !manuallyToggledRef.current.has(path) && !reviewedFiles.has(path);
        if (known.has(path) && !reapply) {
          if (prev.has(path)) {
            next.add(path);
          }
        } else if (autoCollapse && autoCollapsible.has(path) && !filesWithComments.has(path)) {
          next.add(path);
        }
      }
      return next;
    });
    knownPathsRef.current = new Set(diff.files.map((file) => getFilePath(file)));
  }, [diff, autoCollapse]);

  useEffect(() => {
    if (!serverViewed) {
      return;
    }
    // Files the server no longer reports as viewed changed since they were
    // marked, so reopen them to show the change.
    // A viewed file with newer comments stays open even when its viewed state
    // only arrives now (e.g. after a failed first load), so the comment isn't
    // hidden.
    const unviewed = [...reviewedFiles].filter((path) => !serverViewed.viewed.includes(path));
    const commentedSinceViewed = getFilesCommentedSinceViewed(threads, serverViewed.viewedAt);
    const newlyViewed = serverViewed.viewed.filter((path) => !reviewedFiles.has(path) && !commentedSinceViewed.has(path));
    setReviewedFiles(new Set(serverViewed.viewed));
    if (newlyViewed.length > 0 || unviewed.length > 0) {
      setCollapsedFiles((prev) => {
        const next = new Set(prev);
        for (const path of newlyViewed) {
          next.add(path);
        }
        for (const path of unviewed) {
          next.delete(path);
        }
        return next;
      });
    }
  }, [serverViewed]);

  useEffect(() => {
    // Surface commented files once, when threads first load. After that the
    // user owns collapse state, so comments arriving while they read (e.g. from
    // an AI review) don't reopen files they collapsed or marked viewed. A viewed
    // file still opens if it was commented on after being marked, so that
    // comment isn't hidden behind the viewed state.
    if (serverThreads === undefined || hasSeededCommentsRef.current) {
      return;
    }
    hasSeededCommentsRef.current = true;
    const commentedSinceViewed = getFilesCommentedSinceViewed(threads, serverViewed.viewedAt);
    const toExpand = [...filesWithComments].filter(
      (path) => !serverViewed.viewed.includes(path) || commentedSinceViewed.has(path),
    );
    if (toExpand.length === 0) {
      return;
    }
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      for (const path of toExpand) {
        next.delete(path);
      }
      return next;
    });
  }, [serverThreads, threads, filesWithComments, serverViewed]);

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
    const selection = focusSearchInput(input);
    if (selection) {
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
    onEscape: (event) => {
      if (showHelp) {
        setShowHelp(false);
        return;
      }
      if (shouldRequestHostClose(event.defaultPrevented, !!document.querySelector('dialog[open]'))) {
        requestHostClose();
      }
    },
  });

  const queryClient = useQueryClient();

  const handleRevert = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['diff'] });
    queryClient.invalidateQueries({ queryKey: ['viewed'] });
  }, [queryClient]);

  const handleRefreshDiff = useCallback(async () => {
    try {
      await refreshDiffWithGate(refParam, () => {
        queryClient.invalidateQueries({ queryKey: ['diff'] });
        queryClient.invalidateQueries({ queryKey: ['viewed'] });
        resetStaleness();
      }, () => {
        const url = new URL(window.location.href);
        url.searchParams.delete('load');
        window.location.replace(`${url.pathname}${url.search}${url.hash}`);
      });
    } catch {
      toast.error('Failed to check diff size');
    }
  }, [queryClient, refParam, resetStaleness]);

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
        commentsEnabled={reviewsEnabled}
        commentActions={commentActions}
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
        {diff.files.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2">
            <div className="text-added opacity-40 mb-1">
              <CheckCircleIcon />
            </div>
            <h2 className="text-base font-medium text-text-secondary">No changes found</h2>
            <p className="text-xs text-text-muted">There are no differences to display.</p>
          </div>
        ) : <Sidebar
          files={diff?.files || []}
          activeFile={activeFile}
          reviewedFiles={reviewedFiles}
          commentCountsByFile={commentCountsByFile}
          onFileClick={handleSidebarFileClick}
          onCommentedFileClick={handleSidebarCommentedFileClick}
          onReviewedChangeMany={handleReviewedChangeMany}
        />}
        {diff.files.length > 0 ? (
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
