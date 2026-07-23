import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  useConfirmPrimarySslMutation,
  useRollbackPrimarySslMutation,
} from '@/services/primarySslApi';
import { useToast } from '@/hooks/use-toast';
import { errorMessage } from './toastError';

function formatRemaining(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function RollbackPanel({
  pendingRevert,
}: {
  pendingRevert: { deadlineMs: number } | null;
}) {
  const { toast } = useToast();
  const [confirmPrimarySsl, { isLoading: isConfirming }] = useConfirmPrimarySslMutation();
  const [rollbackPrimarySsl, { isLoading: isRollingBack }] = useRollbackPrimarySslMutation();
  const [remainingMs, setRemainingMs] = useState<number>(
    pendingRevert ? pendingRevert.deadlineMs - Date.now() : 0,
  );

  useEffect(() => {
    if (!pendingRevert) return;
    setRemainingMs(pendingRevert.deadlineMs - Date.now());
    const interval = setInterval(() => {
      setRemainingMs(pendingRevert.deadlineMs - Date.now());
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRevert?.deadlineMs]);

  const handleConfirm = async () => {
    try {
      await confirmPrimarySsl().unwrap();
      toast({ title: 'Changes kept', description: 'The SSL configuration will not be auto-reverted.' });
    } catch (error: unknown) {
      toast({ title: 'Error', description: errorMessage(error, 'Failed to confirm changes'), variant: 'destructive' });
    }
  };

  const handleRollback = async () => {
    try {
      await rollbackPrimarySsl().unwrap();
      toast({ title: 'Restored', description: 'Previous SSL configuration restored.' });
    } catch (error: unknown) {
      toast({ title: 'Error', description: errorMessage(error, 'Failed to restore previous configuration'), variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4">
      {pendingRevert && (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-4 space-y-2">
          <p className="text-sm font-medium">
            Auto-revert in {formatRemaining(remainingMs)}
          </p>
          <p className="text-sm text-muted-foreground">
            If you don&apos;t confirm before the countdown ends, the previous SSL configuration
            will be restored automatically.
          </p>
          <Button onClick={handleConfirm} disabled={isConfirming}>
            {isConfirming ? 'Keeping…' : 'Keep these changes'}
          </Button>
        </div>
      )}
      <Button variant="outline" onClick={handleRollback} disabled={isRollingBack}>
        {isRollingBack ? 'Restoring…' : 'Restore previous SSL configuration'}
      </Button>
    </div>
  );
}
