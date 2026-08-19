import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useUpdateAppMutation, type CatalogEntry, type InstalledSummary } from '@/services/appCatalogApi';
import { GateBlockedCta } from './GateBlockedCta';

interface InstallUpdateButtonProps {
  entry: CatalogEntry;
  /** The install to move to `entry.registryVersion`. */
  install: InstalledSummary;
  /** Fired once the update job has been accepted — the parent shows its progress. */
  onUpdateStarted: (entry: CatalogEntry, jobId: string) => void;
  size?: 'default' | 'sm';
  variant?: 'default' | 'outline';
}

/**
 * InstallUpdateButton — "Update to vX" for ONE install, with the prune toggle
 * confirm popover. Shared by the catalog card (single-install case) and the
 * per-install rows in the details dialog so both fire exactly the same
 * mutation with the same confirm step. Renders nothing when this install has
 * no update; renders the disabled, explained gate CTA instead when an instance
 * gate fails (the job would refuse at its preflight step anyway).
 */
export function InstallUpdateButton({
  entry,
  install,
  onUpdateStarted,
  size = 'default',
  variant = 'default',
}: InstallUpdateButtonProps) {
  const { toast } = useToast();
  const [updateApp, { isLoading: isUpdating }] = useUpdateAppMutation();
  const [open, setOpen] = useState(false);
  const [prune, setPrune] = useState(false);

  if (!install.updateAvailable || !entry.registryVersion) return null;

  const failedGate = entry.gates.find((gate) => gate.status === 'fail');
  if (failedGate) return <GateBlockedCta gate={failedGate} />;

  const handleConfirm = async () => {
    try {
      const result = await updateApp({ id: install.installedAppId, prune }).unwrap();
      setOpen(false);
      setPrune(false);
      onUpdateStarted(entry, result.jobId);
    } catch (err) {
      const message = (err as { data?: { message?: string } })?.data?.message ?? 'Update failed';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    }
  };

  const switchId = `prune-${install.installedAppId}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size={size} variant={variant} disabled={isUpdating}>
          {`Update to v${entry.registryVersion}`}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={switchId} className="font-normal">
            Reset to the app&apos;s shipped rules (prune)
          </Label>
          <Switch id={switchId} checked={prune} onCheckedChange={setPrune} />
        </div>
        <Button className="w-full" onClick={handleConfirm} disabled={isUpdating}>
          {isUpdating ? 'Starting…' : 'Confirm update'}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
