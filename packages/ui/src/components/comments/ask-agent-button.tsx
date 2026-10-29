import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { askAgent, fetchPendingAsks } from '../../lib/api';
import { useAskAvailable } from '../../hooks/use-ask-available';
import { Spinner } from '../icons/spinner';

interface AskAgentButtonProps {
  threadId: string;
}

export function AskAgentButton(props: AskAgentButtonProps) {
  const { threadId } = props;
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState(false);
  const askAvailable = useAskAvailable();
  const { data: pending } = useQuery({
    queryKey: ['ask-pending'],
    queryFn: fetchPendingAsks,
    refetchInterval: (query) => (query.state.data?.threadIds.length ? 1500 : false),
  });

  const isPending = !!pending?.threadIds.includes(threadId);

  useEffect(() => {
    if (asking && pending && !isPending) {
      setAsking(false);
      queryClient.invalidateQueries({ queryKey: ['threads'] });
    }
  }, [asking, isPending, pending, queryClient]);

  if (!askAvailable) {
    return null;
  }

  const busy = asking || isPending;

  const handleClick = async () => {
    setAsking(true);
    try {
      await askAgent(threadId);
      await queryClient.refetchQueries({ queryKey: ['ask-pending'] });
    } catch (err) {
      setAsking(false);
      toast.error(err instanceof Error ? err.message : 'Failed to ask your agent');
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={busy}
      className="inline-flex items-center gap-1 text-[11px] text-accent hover:text-accent-hover transition-colors cursor-pointer disabled:cursor-wait disabled:opacity-70"
      title="Sends the question to your workspace agent, which answers here"
    >
      {busy && <Spinner />}
      {busy ? 'Waiting for your agent…' : 'Ask your agent'}
    </button>
  );
}
