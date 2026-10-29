import { useQuery } from '@tanstack/react-query';
import { repoInfoOptions } from '../queries/info';

export function useAskAvailable(): boolean {
  const { data } = useQuery({ ...repoInfoOptions(), staleTime: Infinity, select: (info) => !!info.askAgent });
  return !!data;
}
