import { useSuspenseQuery } from '@tanstack/react-query';
import { viewedOptions } from '../queries/viewed';

export function useViewedFiles(ref: string | undefined) {
  return useSuspenseQuery(viewedOptions(ref));
}
