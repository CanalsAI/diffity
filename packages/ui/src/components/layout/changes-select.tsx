import { useNavigation, useSearchParams } from 'react-router';
import { isWorkingTreeRef, type ViewMode } from '../../lib/diff-utils';

interface ChangesSelectProps {
  diffRef?: string;
  viewMode: ViewMode;
}

export function ChangesSelect({ diffRef = 'work', viewMode }: ChangesSelectProps) {
  const navigation = useNavigation();
  const [searchParams, setSearchParams] = useSearchParams();
  const pendingRef = navigation.location?.pathname === '/diff'
    ? new URLSearchParams(navigation.location.search).get('ref') || 'work'
    : diffRef;

  return (
    <select
      aria-label="Changes to show"
      value={isWorkingTreeRef(pendingRef) ? pendingRef : diffRef}
      onChange={(event) => {
        const params = new URLSearchParams(searchParams);
        params.set('ref', event.target.value);
        params.set('view', viewMode);
        params.delete('load');
        setSearchParams(params);
      }}
      className="rounded-md border border-border bg-bg-tertiary px-2 py-1 text-xs text-text cursor-pointer shrink-0"
    >
      <option value="work">All changes</option>
      <option value="staged">Staged</option>
      <option value="unstaged">Unstaged</option>
    </select>
  );
}
