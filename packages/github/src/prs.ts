import { execFile } from 'node:child_process';
import { getViewerLogin } from './detection.js';
import type { PrListItem, PrListResponse, PrStatus, PrTeam } from './types.js';

const PR_FIELDS = `
    nodes {
      ... on PullRequest {
        number
        title
        url
        isDraft
        updatedAt
        mergeable
        reviewDecision
        author { login }
        repository { nameWithOwner }
        comments { totalCount }
        labels(first: 8) { nodes { name color } }
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      }
    }`;

interface PrNode {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  updatedAt: string;
  mergeable: string;
  reviewDecision: string | null;
  author: { login: string } | null;
  repository: { nameWithOwner: string };
  comments: { totalCount: number };
  labels: { nodes: { name: string; color: string }[] };
  commits: { nodes: { commit: { statusCheckRollup: { state: string } | null } }[] };
}

function ghJson<T>(args: string[]): Promise<T> {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { maxBuffer: 20 * 1024 * 1024, timeout: 30_000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr.trim() || err.message));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as T);
      } catch (parseErr) {
        reject(parseErr);
      }
    });
  });
}

function getStatus(node: PrNode): PrStatus {
  const checks = node.commits.nodes[0]?.commit.statusCheckRollup?.state;
  if (node.isDraft) {
    return { label: 'Draft', tone: 'neutral' };
  }
  if (node.mergeable === 'CONFLICTING') {
    return { label: 'Merge conflicts', tone: 'warning' };
  }
  if (checks === 'FAILURE' || checks === 'ERROR') {
    return { label: 'CI failing', tone: 'danger' };
  }
  if (node.reviewDecision === 'CHANGES_REQUESTED') {
    return { label: 'Changes requested', tone: 'danger' };
  }
  if (checks === 'PENDING' || checks === 'EXPECTED') {
    return { label: 'Awaiting CI', tone: 'warning' };
  }
  if (node.reviewDecision === 'APPROVED') {
    return { label: 'Approved', tone: 'success' };
  }
  return { label: 'Awaiting approval', tone: 'warning' };
}

function toPrListItem(node: PrNode): PrListItem {
  const [owner, repo] = node.repository.nameWithOwner.split('/');
  return {
    owner,
    repo,
    number: node.number,
    title: node.title,
    url: node.url,
    author: node.author?.login ?? 'ghost',
    updatedAt: node.updatedAt,
    commentCount: node.comments.totalCount,
    labels: node.labels.nodes,
    status: getStatus(node),
  };
}

// Runs every search in one GraphQL request (one aliased `search` field each), so a
// view costs a single `gh` call however many sections it has.
async function searchPrs(queries: string[]): Promise<PrListItem[][]> {
  const variables = queries.map((_, i) => `$q${i}: String!`).join(', ');
  const fields = queries.map((_, i) => `s${i}: search(query: $q${i}, type: ISSUE, first: 40) { ${PR_FIELDS} }`).join('\n');
  const args = ['api', 'graphql', '-f', `query=query(${variables}) {\n${fields}\n}`];
  queries.forEach((q, i) => args.push('-f', `q${i}=${q}`));
  const { data } = await ghJson<{ data: Record<string, { nodes: (PrNode | null)[] }> }>(args);
  return queries.map((_, i) => data[`s${i}`].nodes
    .filter((node): node is PrNode => !!node && !!node.number)
    .map(toPrListItem));
}

const UPDATED_DAYS: Record<string, number> = { week: 7, month: 30, quarter: 90 };
const TEAMS_TTL_MS = 5 * 60_000;
const MAX_CUSTOM_QUERY = 300;

export interface PrListOptions {
  org: string | null;
  view?: string;
  updated?: string;
  query?: string;
}

let teamsCache: { org: string; at: number; teams: PrTeam[] } | null = null;

async function getMyTeams(org: string): Promise<PrTeam[]> {
  if (teamsCache && teamsCache.org === org && Date.now() - teamsCache.at < TEAMS_TTL_MS) {
    return teamsCache.teams;
  }
  const raw = await ghJson<{ slug: string; name: string; organization: { login: string } }[]>(['api', 'user/teams', '--paginate']);
  const teams = raw
    .filter((t) => t.organization.login.toLowerCase() === org.toLowerCase())
    .map((t) => ({ slug: t.slug, name: t.name }));
  teamsCache = { org, at: Date.now(), teams };
  return teams;
}

function baseQuery(org: string | null, updated: string | undefined): string {
  const parts = ['is:pr', 'is:open', 'archived:false', 'sort:updated-desc'];
  if (org) {
    parts.push(`org:${org}`);
  }
  const days = updated ? UPDATED_DAYS[updated] : undefined;
  if (days) {
    parts.push(`updated:>=${new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)}`);
  }
  return parts.join(' ');
}

const SIMPLE_VIEWS: Record<string, { title: string; qualifier: string }> = {
  authored: { title: 'Authored by me', qualifier: 'author:@me' },
  assigned: { title: 'Assigned to me', qualifier: 'assignee:@me' },
  involves: { title: 'Involves me', qualifier: 'involves:@me' },
  'review-requested': { title: 'Review requests', qualifier: 'review-requested:@me' },
};

function dedupe(items: PrListItem[], seen: Set<string>): PrListItem[] {
  return items.filter((pr) => {
    const key = `${pr.owner}/${pr.repo}#${pr.number}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export async function listPullRequests(options: PrListOptions): Promise<PrListResponse> {
  const { org, view = 'inbox', updated, query } = options;
  const base = baseQuery(org, updated);
  const [viewer, teams] = await Promise.all([
    getViewerLogin(),
    org ? getMyTeams(org).catch(() => []) : Promise.resolve([]),
  ]);
  const meta = { viewer, org, teams };

  if (view === 'inbox') {
    const [needsReview, drafts, waiting, ...teamResults] = await searchPrs([
      `${base} draft:false review-requested:@me`,
      `${base} draft:true author:@me`,
      `${base} draft:false author:@me`,
      ...(org ? teams.map((t) => `${base} draft:false team-review-requested:${org}/${t.slug}`) : []),
    ]);
    const seen = new Set<string>();
    const direct = dedupe(needsReview, seen);
    const viaTeams = dedupe(teamResults.flat().filter((pr) => pr.author !== viewer), seen);
    return {
      ...meta,
      sections: [
        { id: 'needs-review', title: 'Needs your review', items: direct },
        { id: 'teams-review', title: "Needs your teams' review", items: viaTeams },
        { id: 'drafts', title: 'Your drafts', items: drafts },
        { id: 'waiting', title: 'Waiting for review or checks', items: waiting },
      ],
    };
  }

  if (view.startsWith('team:')) {
    const slug = view.slice('team:'.length);
    const team = teams.find((t) => t.slug === slug);
    if (!org || !team) {
      throw new Error(`Unknown team: ${slug}`);
    }
    const [items] = await searchPrs([`${base} team-review-requested:${org}/${team.slug}`]);
    return { ...meta, sections: [{ id: view, title: `Review requested from ${team.name}`, items }] };
  }

  if (view === 'custom') {
    const text = (query ?? '').trim().slice(0, MAX_CUSTOM_QUERY);
    if (!text) {
      throw new Error('Empty query');
    }
    const [items] = await searchPrs([`${base} ${text}`]);
    return { ...meta, sections: [{ id: 'custom', title: 'Search results', items }] };
  }

  const simple = SIMPLE_VIEWS[view];
  if (!simple) {
    throw new Error(`Unknown view: ${view}`);
  }
  const [items] = await searchPrs([`${base} ${simple.qualifier}`]);
  return { ...meta, sections: [{ id: view, title: simple.title, items }] };
}

export interface PrCheckoutInfo {
  baseRefName: string;
  headRefName: string;
  isCrossRepository: boolean;
}

export function getPrCheckoutInfo(owner: string, repo: string, number: number): Promise<PrCheckoutInfo> {
  return ghJson(['pr', 'view', String(number), '--repo', `${owner}/${repo}`, '--json', 'baseRefName,headRefName,isCrossRepository']);
}
