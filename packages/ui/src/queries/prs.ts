import { queryOptions, keepPreviousData } from '@tanstack/react-query';
import { fetchPullRequests, type PrListParams } from '../lib/api';

export function pullRequestsOptions(params: PrListParams) {
  return queryOptions({
    queryKey: ['pull-requests', params.view, params.updated, params.view === 'custom' ? params.query : ''],
    queryFn: () => fetchPullRequests(params),
    placeholderData: keepPreviousData,
  });
}
