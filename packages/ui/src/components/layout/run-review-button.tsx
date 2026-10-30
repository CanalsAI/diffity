import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { fetchReviewStatus, runReview } from '../../lib/api';
import { useAskAvailable } from '../../hooks/use-ask-available';
import { Spinner } from '../icons/spinner';

interface RunReviewButtonProps {
  sessionId: string | null;
}

export function RunReviewButton({ sessionId }: RunReviewButtonProps) {
  const queryClient = useQueryClient();
  const askAvailable = useAskAvailable();
  const [started, setStarted] = useState(false);
  const { data } = useQuery({
    queryKey: ['review-status'],
    queryFn: fetchReviewStatus,
    enabled: askAvailable,
    refetchInterval: (query) => (query.state.data?.running || started ? 3000 : false),
  });
  const running = !!data?.running;

  useEffect(() => {
    if (started && data && !data.running) {
      setStarted(false);
      queryClient.invalidateQueries({ queryKey: ['threads'] });
      toast.success('Your agent finished the review', { description: 'Drafted comments are in the diff; the summary is in General comments.' });
    }
  }, [started, data, queryClient]);

  if (!askAvailable || !sessionId) {
    return null;
  }

  const handleClick = async () => {
    try {
      await runReview(sessionId!);
      setStarted(true);
      await queryClient.refetchQueries({ queryKey: ['review-status'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start the review');
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={running || started}
      className="inline-flex items-center gap-1.5 rounded-md bg-bg-tertiary px-2.5 py-1 text-xs font-medium text-text-secondary hover:text-text transition-colors cursor-pointer disabled:cursor-wait disabled:opacity-70"
      title="Asks your workspace agent to review these changes and draft its findings as comments"
    >
      {(running || started) && <Spinner />}
      {running || started ? 'Reviewing…' : 'Review with your agent'}
    </button>
  );
}
