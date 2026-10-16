import type { DiffHunk } from '@diffity/parser';
import { ArrowUpIcon } from '../icons/arrow-up-icon';
import { ArrowDownIcon } from '../icons/arrow-down-icon';
import { ChevronUpDownIcon } from '../icons/chevron-up-down-icon';
import { Spinner } from '../icons/spinner';

export interface ExpandControls {
  position: 'top' | 'between' | 'bottom';
  remainingLines: number;
  remainingUp: number;
  remainingDown: number;
  loadingDirection: 'up' | 'down' | 'all' | null;
  wasExpanded: boolean;
  onExpand: (direction: 'up' | 'down' | 'all') => void;
}

interface HunkHeaderProps {
  hunk: DiffHunk;
  expandControls?: ExpandControls;
}

export function formatHunkHeader(hunk: DiffHunk): string {
  const range = `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`;
  if (hunk.context) {
    return `${range} ${hunk.context}`;
  }
  return range;
}

const SMALL_GAP_THRESHOLD = 40;

const gutterCell = 'w-[25px] min-w-[25px] bg-diff-hunk-bg border-r border-border-muted p-0';
const expandBtn = 'flex items-center justify-center w-full h-[18px] cursor-pointer text-diff-hunk-text/70 hover:text-diff-hunk-text transition-colors';
const expandRow = 'bg-diff-hunk-bg';

function SpinnerCell() {
  return (
    <td className={gutterCell}>
      <div className="flex items-center justify-center h-[18px]">
        <Spinner />
      </div>
    </td>
  );
}

export function HunkHeader(props: HunkHeaderProps) {
  const { hunk, expandControls } = props;

  if (!expandControls) {
    return (
      <tr className="bg-diff-hunk-bg group/hunk">
        <td colSpan={4} className="px-3 py-1 font-mono text-xs text-diff-hunk-text select-none">
          {formatHunkHeader(hunk)}
        </td>
      </tr>
    );
  }

  const { position, remainingLines, remainingUp, remainingDown, loadingDirection, wasExpanded, onExpand } = expandControls;

  if (remainingLines <= 0) {
    if (wasExpanded) {
      return null;
    }
    return (
      <tr className="bg-diff-hunk-bg group/hunk">
        <td colSpan={4} className="px-3 py-1 font-mono text-xs text-diff-hunk-text select-none">
          {formatHunkHeader(hunk)}
        </td>
      </tr>
    );
  }

  const isSmallGap = remainingLines <= SMALL_GAP_THRESHOLD;
  const showUp = remainingUp > 0;
  const showDown = remainingDown > 0;
  const expandAllButton = (
    <button
      className={expandBtn}
      disabled={loadingDirection !== null}
      onClick={() => onExpand('all')}
      title={`Expand all ${remainingLines} lines`}
      aria-label={`Expand all ${remainingLines} lines`}
    >
      <ChevronUpDownIcon />
    </button>
  );

  if (position === 'top') {
    return (
      <tr className="bg-diff-hunk-bg group/hunk">
        {loadingDirection ? <SpinnerCell /> : (
          <td className={gutterCell}>
            <div className="flex">
              <button className={expandBtn} onClick={() => onExpand('up')} title={`Expand ${Math.min(remainingLines, 20)} lines`}>
                <ArrowUpIcon />
              </button>
              {expandAllButton}
            </div>
          </td>
        )}
        <td colSpan={3} className="px-3 py-1 font-mono text-xs text-diff-hunk-text select-none">
          {formatHunkHeader(hunk)}
        </td>
      </tr>
    );
  }

  if (isSmallGap || (!showUp && showDown) || (showUp && !showDown)) {
    return (
      <tr className="bg-diff-hunk-bg group/hunk">
        {loadingDirection ? <SpinnerCell /> : (
          <td className={gutterCell}>
            <button
              className={expandBtn}
              onClick={() => onExpand(isSmallGap ? 'all' : showUp ? 'up' : 'down')}
              title={isSmallGap ? `Expand all ${remainingLines} lines` : `Expand ${Math.min(remainingLines, 20)} lines`}
            >
              {isSmallGap ? <ChevronUpDownIcon /> : showUp ? <ArrowUpIcon /> : <ArrowDownIcon />}
            </button>
          </td>
        )}
        <td colSpan={3} className="px-3 py-1 font-mono text-xs text-diff-hunk-text select-none">
          {formatHunkHeader(hunk)}
        </td>
      </tr>
    );
  }

  return (
    <>
      <tr className={expandRow}>
        {loadingDirection ? <SpinnerCell /> : (
          <td className={gutterCell}>
            <button className={expandBtn} onClick={() => onExpand('down')} title="Expand down">
              <ArrowDownIcon />
            </button>
          </td>
        )}
        <td colSpan={3} />
      </tr>
      <tr className="bg-diff-hunk-bg group/hunk">
        <td className={gutterCell}>{expandAllButton}</td>
        <td colSpan={3} className="px-3 py-1 font-mono text-xs text-diff-hunk-text select-none">
          {formatHunkHeader(hunk)}
        </td>
      </tr>
      <tr className={expandRow}>
        {loadingDirection ? <SpinnerCell /> : (
          <td className={gutterCell}>
            <button className={expandBtn} onClick={() => onExpand('up')} title="Expand up">
              <ArrowUpIcon />
            </button>
          </td>
        )}
        <td colSpan={3} />
      </tr>
    </>
  );
}
