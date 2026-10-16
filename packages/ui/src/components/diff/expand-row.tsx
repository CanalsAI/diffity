import { ArrowUpIcon } from '../icons/arrow-up-icon';
import { ArrowDownIcon } from '../icons/arrow-down-icon';
import { ChevronUpDownIcon } from '../icons/chevron-up-down-icon';
import { Spinner } from '../icons/spinner';

interface ExpandRowProps {
  position: 'top' | 'bottom';
  remainingLines: number;
  loading: boolean;
  onExpand: (dir: 'up' | 'down' | 'all') => void;
}

const gutterCell = 'w-[25px] min-w-[25px] bg-diff-hunk-bg border-r border-border-muted p-0';
const expandBtn = 'flex items-center justify-center w-full h-[18px] cursor-pointer text-diff-hunk-text/70 hover:text-diff-hunk-text transition-colors';
const expandRowClass = 'bg-diff-hunk-bg';

export function ExpandRow(props: ExpandRowProps) {
  const { position, remainingLines, loading, onExpand } = props;

  if (remainingLines <= 0) {
    return null;
  }

  return (
    <tr className={expandRowClass}>
      {loading ? (
        <td className={gutterCell}>
          <div className="flex items-center justify-center h-[18px]">
            <Spinner />
          </div>
        </td>
      ) : (
        <td className={gutterCell}>
          <div className="flex">
            <button
              className={expandBtn}
              onClick={() => onExpand('down')}
              title={`Expand ${Math.min(remainingLines, 20)} lines`}
            >
              {position === 'bottom' ? <ArrowDownIcon /> : <ArrowUpIcon />}
            </button>
            <button
              className={expandBtn}
              onClick={() => onExpand('all')}
              title={`Expand all ${remainingLines} lines`}
              aria-label={`Expand all ${remainingLines} lines`}
            >
              <ChevronUpDownIcon />
            </button>
          </div>
        </td>
      )}
      <td colSpan={3} />
    </tr>
  );
}
