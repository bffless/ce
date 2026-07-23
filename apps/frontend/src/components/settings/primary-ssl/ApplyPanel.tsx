import { Button } from '@/components/ui/button';
import { useApplyPrimarySslMutation, type PrimarySslApplyBody } from '@/services/primarySslApi';
import { useToast } from '@/hooks/use-toast';

function errorMessage(error: unknown, fallback: string): string {
  const err = error as { data?: { message?: string } };
  return err?.data?.message || fallback;
}

export function ApplyPanel({
  config,
  disabled,
}: {
  config: PrimarySslApplyBody;
  disabled: boolean;
}) {
  const { toast } = useToast();
  const [applyPrimarySsl, { isLoading }] = useApplyPrimarySslMutation();

  const handleApply = async () => {
    try {
      const result = await applyPrimarySsl(config).unwrap();
      if (result.kind === 'serving') {
        toast({
          title: 'Applied — confirmation required',
          description:
            'A confirmation countdown has started. Reachability may change; confirm below once you’ve verified the site loads, or it will auto-revert.',
        });
      } else {
        toast({ title: 'Applied', description: 'Certificate updated successfully.' });
      }
    } catch (error: unknown) {
      toast({ title: 'Error', description: errorMessage(error, 'Failed to apply SSL configuration'), variant: 'destructive' });
    }
  };

  return (
    <Button onClick={handleApply} disabled={disabled || isLoading}>
      {isLoading ? 'Applying…' : 'Apply changes'}
    </Button>
  );
}
