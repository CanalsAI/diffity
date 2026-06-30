import { queryOptions } from '@tanstack/react-query';
import { fetchViewedFiles } from '../lib/api';

export function viewedOptions(ref?: string) {
  return queryOptions({
    queryKey: ['viewed', ref ?? null],
    queryFn: () => fetchViewedFiles(ref),
  });
}
