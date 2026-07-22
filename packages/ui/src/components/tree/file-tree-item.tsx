import { useEffect, useMemo, useRef, useState } from 'react';
import { flattenTreeFiles, type DirNode, type TreeNode } from '../../lib/file-tree';
import { cn } from '../../lib/cn';
import { StatusBadge } from '../ui/status-badge';
import { ChevronIcon } from '../icons/chevron-icon';
import { FolderIcon } from '../icons/folder-icon';
import { FileIcon } from '../icons/file-icon';
import { CommentIcon } from '../icons/comment-icon';
import { EllipsisIcon } from '../icons/ellipsis-icon';
import { EyeIcon } from '../icons/eye-icon';
import { EyeOffIcon } from '../icons/eye-off-icon';

interface FileTreeItemProps {
  node: TreeNode;
  depth: number;
  activeFile: string | null;
  reviewedFiles: Set<string>;
  commentCountsByFile: Map<string, number>;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  onCollapseDir?: (path: string) => void;
  onExpandOnly?: (path: string) => void;
  onFileClick: (path: string) => void;
  onReviewedChangeMany?: (paths: string[], reviewed: boolean) => void;
}

export function FileTreeItem(props: FileTreeItemProps) {
  const {
    node,
    depth,
    activeFile,
    reviewedFiles,
    commentCountsByFile,
    expandedDirs,
    onToggleDir,
    onCollapseDir,
    onExpandOnly,
    onFileClick,
  } = props;
  const paddingLeft = depth * 12 + 8;

  if (node.type === 'dir') {
    return (
      <DirTreeItem {...props} node={node} paddingLeft={paddingLeft} />
    );
  }

  const isActive = activeFile === node.path;
  const isReviewed = reviewedFiles.has(node.path);
  const threadCount = commentCountsByFile.get(node.path) ?? 0;
  const hasComments = threadCount > 0;

  return (
    <button
      className={cn(
        'flex items-center gap-1.5 w-full py-1 pr-2 text-left text-[13px] cursor-pointer border-l-2',
        isActive
          ? 'bg-active border-l-accent'
          : 'border-l-transparent hover:bg-hover',
        isReviewed && 'opacity-50'
      )}
      style={{ paddingLeft: `${paddingLeft + 15}px` }}
      onClick={() => onFileClick(node.path)}
      onContextMenu={(e) => {
        if (!onExpandOnly) {
          return;
        }
        e.preventDefault();
        const parts = node.path.split('/');
        if (parts.length > 1) {
          onExpandOnly(parts.slice(0, -1).join('/'));
        } else {
          onExpandOnly('');
        }
        onFileClick(node.path);
      }}
    >
      {node.file ? <StatusBadge status={node.file.status} compact /> : <FileIcon className="w-4 h-4 shrink-0 text-text-muted" />}
      <span className={cn('flex-1 min-w-0 truncate text-text', isReviewed && 'line-through')}>
        {node.name}
      </span>
      {hasComments && (
        <span
          className="flex items-center gap-1 text-accent shrink-0"
          title={`${threadCount} open comment thread${threadCount === 1 ? '' : 's'}`}
        >
          <CommentIcon className="w-3 h-3" />
          <span className="text-[10px] font-semibold leading-none">{threadCount}</span>
        </span>
      )}
      {isReviewed && (
        <span className="text-added text-[10px] shrink-0" title="Viewed">&#10003;</span>
      )}
    </button>
  );
}

const dirMenuItemClass =
  'flex items-center gap-2.5 w-full px-3 py-1.5 text-xs text-text-secondary hover:bg-hover hover:text-text transition-colors cursor-pointer text-left';

interface DirTreeItemProps extends FileTreeItemProps {
  node: DirNode;
  paddingLeft: number;
}

function DirTreeItem(props: DirTreeItemProps) {
  const {
    node,
    depth,
    activeFile,
    reviewedFiles,
    commentCountsByFile,
    expandedDirs,
    onToggleDir,
    onCollapseDir,
    onExpandOnly,
    onFileClick,
    onReviewedChangeMany,
    paddingLeft,
  } = props;

  const isExpanded = expandedDirs.has(node.path);
  const [menuOpen, setMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const descendantPaths = useMemo(
    () => flattenTreeFiles(node.children).map(file => file.path),
    [node.children],
  );
  const viewedCount = descendantPaths.reduce(
    (count, path) => count + (reviewedFiles.has(path) ? 1 : 0),
    0,
  );
  const allViewed = descendantPaths.length > 0 && viewedCount === descendantPaths.length;
  const anyViewed = viewedCount > 0;
  const menuEnabled = !!onReviewedChangeMany && descendantPaths.length > 0;

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  const handleContextMenu = (e: React.MouseEvent) => {
    if (menuEnabled) {
      e.preventDefault();
      setMenuOpen(true);
      return;
    }
    if (!onExpandOnly) {
      return;
    }
    e.preventDefault();
    onExpandOnly(node.path);
    onToggleDir(node.path);
  };

  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onCollapseDir && isExpanded) {
      onCollapseDir(node.path);
    } else {
      onToggleDir(node.path);
    }
  };

  const markAll = (viewed: boolean) => {
    onReviewedChangeMany?.(descendantPaths, viewed);
    setMenuOpen(false);
  };

  return (
    <>
      <div className="relative group/dir" ref={containerRef}>
        <button
          className={cn(
            'flex items-center gap-1.5 w-full py-1 pr-2 text-left text-[13px] hover:bg-hover cursor-pointer',
            allViewed && 'opacity-50',
          )}
          style={{ paddingLeft: `${paddingLeft}px` }}
          onClick={() => onToggleDir(node.path)}
          onContextMenu={handleContextMenu}
        >
          <span onClick={handleChevronClick} className="relative flex items-center rounded p-0.5 hover:bg-border/70 transition-colors">
            <ChevronIcon expanded={isExpanded} />
          </span>
          <FolderIcon open={isExpanded} />
          <span className="flex-1 min-w-0 truncate text-text">{node.name}</span>
          {allViewed && (
            <span className="text-added text-[10px] shrink-0" title="All files viewed">&#10003;</span>
          )}
          {menuEnabled && (
            <span
              role="button"
              aria-label="Folder actions"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(open => !open);
              }}
              className={cn(
                'flex items-center rounded p-0.5 text-text-muted hover:text-text hover:bg-border/70 transition-colors shrink-0',
                menuOpen ? 'opacity-100' : 'opacity-0 group-hover/dir:opacity-100',
              )}
            >
              <EllipsisIcon className="w-3.5 h-3.5" />
            </span>
          )}
        </button>
        {menuOpen && menuEnabled && (
          <div className="absolute right-2 top-full z-50 mt-0.5 w-44 py-1 bg-bg-secondary rounded-md shadow-lg ring-1 ring-border">
            {!allViewed && (
              <button className={dirMenuItemClass} onClick={() => markAll(true)}>
                <EyeIcon className="w-3.5 h-3.5" />
                Mark all as viewed
              </button>
            )}
            {anyViewed && (
              <button className={dirMenuItemClass} onClick={() => markAll(false)}>
                <EyeOffIcon className="w-3.5 h-3.5" />
                Mark all as unviewed
              </button>
            )}
          </div>
        )}
      </div>
      {isExpanded && node.children.map(child => (
        <FileTreeItem
          key={child.path}
          node={child}
          depth={depth + 1}
          activeFile={activeFile}
          reviewedFiles={reviewedFiles}
          commentCountsByFile={commentCountsByFile}
          expandedDirs={expandedDirs}
          onToggleDir={onToggleDir}
          onCollapseDir={onCollapseDir}
          onExpandOnly={onExpandOnly}
          onFileClick={onFileClick}
          onReviewedChangeMany={onReviewedChangeMany}
        />
      ))}
    </>
  );
}
