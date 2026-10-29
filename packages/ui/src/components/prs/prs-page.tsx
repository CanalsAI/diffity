import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { toast } from 'sonner';
import { pullRequestsOptions } from '../../queries/prs';
import { openPullRequest, type PrListItem, type PrStatus } from '../../lib/api';
import { instanceOrigin } from '../../lib/instance-url';
import { useTheme } from '../../hooks/use-theme';
import { ChevronIcon } from '../icons/chevron-icon';
import { GitHubIcon } from '../icons/github-icon';
import { SearchIcon } from '../icons/search-icon';
import { Spinner } from '../icons/spinner';
import { cn } from '../../lib/cn';

dayjs.extend(relativeTime);

const TONE_CLASS: Record<PrStatus['tone'], string> = {
  success: 'bg-added',
  warning: 'bg-modified',
  danger: 'bg-deleted',
  neutral: 'bg-text-muted',
};

const VIEWS = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'authored', label: 'Authored by me' },
  { id: 'assigned', label: 'Assigned to me' },
  { id: 'involves', label: 'Involves me' },
  { id: 'review-requested', label: 'Review requests' },
];

const UPDATED_OPTIONS = [
  { value: '', label: 'Updated: any time' },
  { value: 'week', label: 'Updated: last week' },
  { value: 'month', label: 'Updated: last month' },
  { value: 'quarter', label: 'Updated: last 3 months' },
];

function prKey(pr: PrListItem): string {
  return `${pr.owner}/${pr.repo}#${pr.number}`;
}

export function PrsPage() {
  useTheme();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get('view') || 'inbox';
  const updated = searchParams.get('updated') ?? 'month';
  const query = searchParams.get('query') || '';
  const label = searchParams.get('label') || '';
  const [queryDraft, setQueryDraft] = useState(query);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(['drafts', 'teams-review', 'waiting']));
  const [opening, setOpening] = useState<string | null>(null);

  const { data, error, isFetching, isPlaceholderData, refetch } = useQuery(pullRequestsOptions({ view, updated, query }));

  const setParam = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value) {
        next.set(key, value);
      } else {
        next.delete(key);
      }
    }
    setSearchParams(next);
  };

  const selectView = (id: string) => setParam({ view: id === 'inbox' ? null : id, label: null });

  const allLabels = useMemo(() => {
    const names = new Set<string>();
    data?.sections.forEach((s) => s.items.forEach((pr) => pr.labels.forEach((l) => names.add(l.name))));
    return Array.from(names).sort();
  }, [data]);

  const sections = useMemo(() => (data?.sections ?? []).map((section) => ({
    ...section,
    items: label ? section.items.filter((pr) => pr.labels.some((l) => l.name === label)) : section.items,
  })), [data, label]);

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  };

  const handleOpen = async (pr: PrListItem) => {
    if (opening) {
      return;
    }
    setOpening(prKey(pr));
    try {
      const { port, ref } = await openPullRequest(pr);
      const params = new URLSearchParams({ ref });
      const theme = document.documentElement.getAttribute('data-theme');
      if (theme) {
        params.set('theme', theme);
      }
      window.location.href = `${instanceOrigin(port)}/diff?${params.toString()}`;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to open pull request');
      setOpening(null);
    }
  };

  const singleSection = sections.length === 1;

  return (
    <div className="flex flex-col min-h-screen bg-bg text-text font-sans">
      <div className="border-b border-border bg-bg-secondary px-4 py-2.5">
        <div className="flex items-center gap-3">
          <GitHubIcon className="w-5 h-5" />
          <h1 className="font-semibold text-base">Pull requests</h1>
          {data && (
            <span className="text-text-muted text-xs">
              {data.viewer}{data.org ? ` · ${data.org}` : ''}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {allLabels.length > 0 && (
              <select
                aria-label="Filter by label"
                value={label}
                onChange={(e) => setParam({ label: e.target.value })}
                className="rounded-md border border-border bg-bg-tertiary px-2 py-1 text-xs text-text cursor-pointer max-w-48"
              >
                <option value="">All labels</option>
                {allLabels.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            )}
            <select
              aria-label="Updated"
              value={updated}
              onChange={(e) => setParam({ updated: e.target.value || 'any' })}
              className="rounded-md border border-border bg-bg-tertiary px-2 py-1 text-xs text-text cursor-pointer"
            >
              {UPDATED_OPTIONS.map((o) => <option key={o.value} value={o.value || 'any'}>{o.label}</option>)}
            </select>
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="inline-flex items-center gap-1.5 rounded-md bg-bg-tertiary px-2.5 py-1 text-xs text-text-secondary hover:text-text cursor-pointer disabled:opacity-60"
            >
              {isFetching && <Spinner />}
              Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex w-full">
        <nav className="w-44 shrink-0 border-r border-border px-2 py-4 space-y-4 text-[13px]">
          <div className="space-y-0.5">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                onClick={() => selectView(v.id)}
                className={cn(
                  'w-full text-left rounded-md px-2 py-1 cursor-pointer hover:bg-hover',
                  view === v.id && 'bg-active font-medium',
                )}
              >
                {v.label}
              </button>
            ))}
          </div>
          {data && data.teams.length > 0 && (
            <div>
              <div className="px-2 pb-1 text-[11px] font-semibold text-text-muted uppercase tracking-wide">Teams</div>
              <div className="space-y-0.5">
                {data.teams.map((team) => (
                  <button
                    key={team.slug}
                    onClick={() => selectView(`team:${team.slug}`)}
                    className={cn(
                      'w-full text-left rounded-md px-2 py-1 cursor-pointer hover:bg-hover truncate',
                      view === `team:${team.slug}` && 'bg-active font-medium',
                    )}
                    title={`Review requested from ${team.name}`}
                  >
                    {team.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (queryDraft.trim()) {
                setParam({ view: 'custom', query: queryDraft.trim(), label: null });
              }
            }}
          >
            <div className="px-2 pb-1 text-[11px] font-semibold text-text-muted uppercase tracking-wide">Search</div>
            <div className="flex items-center gap-1.5 rounded-md border border-border bg-bg px-2 py-1">
              <SearchIcon className="w-3.5 h-3.5 text-text-muted shrink-0" />
              <input
                value={queryDraft}
                onChange={(e) => setQueryDraft(e.target.value)}
                placeholder="Search PRs"
                className="w-full bg-transparent text-[13px] outline-none placeholder:text-text-muted"
              />
            </div>
          </form>
        </nav>

        <div className={cn('flex-1 min-w-0 px-4 py-4 space-y-4 transition-opacity', isPlaceholderData && 'opacity-60')}>
          {error && (
            <div className="rounded-md border border-border p-4 text-sm text-deleted">
              Failed to load pull requests: {error.message}
            </div>
          )}
          {!data && !error && (
            <div className="flex justify-center py-16"><Spinner className="w-6 h-6" /></div>
          )}
          {sections.map((section) => {
            const isCollapsed = !singleSection && collapsed.has(section.id);
            return (
              <section key={section.id}>
                <button
                  onClick={() => !singleSection && toggle(section.id)}
                  className={cn('flex items-center gap-2 mb-2', !singleSection && 'cursor-pointer')}
                >
                  {!singleSection && <ChevronIcon expanded={!isCollapsed} />}
                  <h2 className="text-[15px] font-semibold">{section.title}</h2>
                  <span className="rounded-full bg-bg-tertiary px-2 text-xs text-text-secondary">{section.items.length}</span>
                </button>
                {!isCollapsed && (
                  <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
                    {section.items.length === 0 && (
                      <div className="px-4 py-6 text-center text-sm text-text-muted">Nothing here</div>
                    )}
                    {section.items.map((pr) => (
                      <PrRow
                        key={prKey(pr)}
                        pr={pr}
                        opening={opening === prKey(pr)}
                        disabled={!!opening}
                        onOpen={() => handleOpen(pr)}
                        onLabel={(name) => setParam({ label: name })}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface PrRowProps {
  pr: PrListItem;
  opening: boolean;
  disabled: boolean;
  onOpen: () => void;
  onLabel: (name: string) => void;
}

function labelStyle(color: string): React.CSSProperties {
  return { backgroundColor: `#${color}`, color: parseInt(color, 16) > 0x808080 ? '#1f2328' : '#ffffff' };
}

function PrRow(props: PrRowProps) {
  const { pr, opening, disabled, onOpen, onLabel } = props;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          onOpen();
        }
      }}
      className={cn(
        'flex items-center gap-3 px-4 py-3 hover:bg-hover transition-colors',
        disabled && !opening ? 'opacity-60 cursor-wait' : 'cursor-pointer',
      )}
    >
      <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4 shrink-0 text-added">
        <path d="M1.5 3.25a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zm5.677-.177L9.573.677A.25.25 0 0110 .854V2.5h1A2.5 2.5 0 0113.5 5v5.628a2.251 2.251 0 11-1.5 0V5a1 1 0 00-1-1h-1v1.646a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354z" />
      </svg>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[15px] font-semibold truncate">{pr.title}</span>
          {pr.labels.map((l) => (
            <button
              key={l.name}
              onClick={(e) => {
                e.stopPropagation();
                onLabel(l.name);
              }}
              style={labelStyle(l.color)}
              className="rounded-full px-2 text-[11px] font-medium leading-4 shrink-0 cursor-pointer"
              title={`Filter by ${l.name}`}
            >
              {l.name}
            </button>
          ))}
        </div>
        <div className="text-[13px] text-text-secondary truncate">
          {pr.owner}/{pr.repo}#{pr.number} · {pr.author} · Updated {dayjs(pr.updatedAt).fromNow()}
          {pr.commentCount > 0 && ` · ${pr.commentCount} comment${pr.commentCount === 1 ? '' : 's'}`}
        </div>
      </div>
      {opening ? (
        <span className="inline-flex items-center gap-2 text-xs text-text-secondary shrink-0">
          <Spinner /> Preparing worktree…
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-[13px] text-text-secondary shrink-0">
          <span className={cn('w-2 h-2 rounded-full', TONE_CLASS[pr.status.tone])} />
          {pr.status.label}
        </span>
      )}
      <a
        href={pr.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="text-text-muted hover:text-text shrink-0"
        title="Open on GitHub"
      >
        <GitHubIcon className="w-4 h-4" />
      </a>
    </div>
  );
}
