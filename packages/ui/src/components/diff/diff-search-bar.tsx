import { useLayoutEffect, useRef, useState } from 'react';
import { ChevronUpIcon } from '../icons/chevron-up-icon';
import { SearchIcon } from '../icons/search-icon';
import { XIcon } from '../icons/x-icon';

/** Base width (matches `w-64`) and the cap the input is allowed to grow to. */
const MIN_WIDTH = 256;
const MAX_WIDTH = 512;

interface DiffSearchBarProps {
  query: string;
  onQueryChange: (query: string) => void;
  matchCount: number;
  /** 0-based index of the active match, or -1 when there are none. */
  currentIndex: number;
  onNext: () => void;
  onPrev: () => void;
}

export function DiffSearchBar(props: DiffSearchBarProps) {
  const { query, onQueryChange, matchCount, currentIndex, onNext, onPrev } = props;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        onPrev();
      } else {
        onNext();
      }
    } else if (e.key === 'Escape' && query.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      onQueryChange('');
    }
  };

  const hasQuery = query.length > 0;
  const status = !hasQuery
    ? ''
    : matchCount === 0
      ? '0/0'
      : `${currentIndex + 1}/${matchCount}`;

  // Grow the input to fit the query. A hidden mirror measures the text width
  // with identical typography; the input's left icon + right controls padding
  // (pl-7 + pr-16 = 5.75rem = 92px) is added on top, then clamped.
  const mirrorRef = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(MIN_WIDTH);

  useLayoutEffect(() => {
    const mirror = mirrorRef.current;
    if (!mirror) return;
    const measured = Math.ceil(mirror.getBoundingClientRect().width) + 92;
    setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, measured)));
  }, [query]);

  return (
    <div className="relative flex items-center h-7">
      <SearchIcon className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
      <span
        ref={mirrorRef}
        aria-hidden="true"
        className="absolute invisible whitespace-pre text-xs"
      >
        {query || 'Search changes...'}
      </span>
      <input
        type="text"
        value={query}
        placeholder="Search changes..."
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
        style={{ width }}
        className="h-7 pl-7 pr-16 border border-border rounded-md bg-bg text-xs outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 placeholder:text-text-muted"
      />
      <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
        {hasQuery && (
          <span className={`text-[10px] tabular-nums px-0.5 ${matchCount === 0 ? 'text-deleted' : 'text-text-muted'}`}>
            {status}
          </span>
        )}
        <button
          onClick={onPrev}
          disabled={matchCount === 0}
          title="Previous match (Shift+Enter)"
          className="p-0.5 rounded text-text-muted hover:text-text hover:bg-hover disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer disabled:cursor-default"
        >
          <ChevronUpIcon className="w-3 h-3" />
        </button>
        <button
          onClick={onNext}
          disabled={matchCount === 0}
          title="Next match (Enter)"
          className="p-0.5 rounded text-text-muted hover:text-text hover:bg-hover disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer disabled:cursor-default"
        >
          <ChevronUpIcon className="w-3 h-3 rotate-180" />
        </button>
        {hasQuery && (
          <button
            onClick={() => onQueryChange('')}
            title="Clear (Esc)"
            className="p-0.5 rounded text-text-muted hover:text-text hover:bg-hover cursor-pointer"
          >
            <XIcon className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}
