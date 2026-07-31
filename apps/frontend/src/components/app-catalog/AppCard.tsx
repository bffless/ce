import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { useUpdateAppMutation, type CatalogEntry } from '@/services/appCatalogApi';
import { UninstallDialog } from './UninstallDialog';
import { EjectPanel } from './EjectPanel';
import { ExternalLink, MoreVertical, HelpCircle } from 'lucide-react';

interface AppCardProps {
  entry: CatalogEntry;
  /** Opens the install wizard dialog (Task 13/14) for this app. */
  onInstall: (entry: CatalogEntry) => void;
  /**
   * Fired once `useUpdateAppMutation` returns a jobId — the parent mounts
   * `InstallDialog` in `mode="update"` with that jobId so the update run
   * reuses the same Working/Done job-progress screens as install.
   */
  onUpdateStarted: (entry: CatalogEntry, jobId: string) => void;
}

/**
 * AppCard — the catalog grid tile for a single app (Task 12 of the
 * app-catalog spec, lifecycle actions completed in Task 14). Implements the
 * CTA state machine from the spec:
 *
 * - not installed, no failing instance gate → "Install" (opens the wizard
 *   dialog via `onInstall`).
 * - not installed, a gate fails → disabled CTA showing the gate's message,
 *   plus a "Why?" popover with the gate's remediation/deepLink.
 * - installed → "Installed · v{version}" badge, an "Open" link to `appUrl`,
 *   and an overflow menu (Update, Uninstall, Eject).
 * - installed + update available → an additional primary "Update to
 *   v{registryVersion}" button that opens a confirm popover (prune toggle,
 *   default off) before firing the update.
 *
 * Uninstall and Eject are delegated to dedicated dialogs (`UninstallDialog`,
 * `EjectPanel`) that each load their own preview/payload data; Update fires
 * `useUpdateAppMutation` here and hands the job off to the shared
 * `InstallDialog` (mounted by the page) for progress.
 */
export function AppCard({ entry, onInstall, onUpdateStarted }: AppCardProps) {
  const { toast } = useToast();
  const { installed } = entry;
  const failedGate = entry.gates.find((gate) => gate.status === 'fail');

  const [updateApp, { isLoading: isUpdating }] = useUpdateAppMutation();
  const [updatePopoverOpen, setUpdatePopoverOpen] = useState(false);
  const [prune, setPrune] = useState(false);
  const [ejectOpen, setEjectOpen] = useState(false);
  const [uninstallOpen, setUninstallOpen] = useState(false);

  const handleConfirmUpdate = async () => {
    if (!installed) return;
    try {
      const result = await updateApp({ id: installed.installedAppId, prune }).unwrap();
      setUpdatePopoverOpen(false);
      setPrune(false);
      onUpdateStarted(entry, result.jobId);
    } catch (err) {
      const message = (err as { data?: { message?: string } })?.data?.message ?? 'Update failed';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    }
  };

  return (
    <Card className="flex flex-col">
      <CardHeader className="flex-row items-start gap-3 space-y-0">
        {entry.iconUrl && (
          <img src={entry.iconUrl} alt="" className="h-10 w-10 rounded-md object-cover" />
        )}
        <div className="min-w-0">
          <h3 className="font-semibold leading-tight truncate">{entry.name}</h3>
          {entry.summary && (
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{entry.summary}</p>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex-1">
        {installed && (
          <Badge variant="secondary">{`Installed · v${installed.version}`}</Badge>
        )}
      </CardContent>

      <CardFooter className="flex flex-wrap items-center gap-2">
        {!installed && !failedGate && (
          <Button disabled={!entry.installable} onClick={() => onInstall(entry)}>
            Install
          </Button>
        )}

        {!installed && failedGate && (
          <>
            <Button disabled aria-label={failedGate.message}>
              {failedGate.message}
            </Button>
            {(failedGate.remediation || failedGate.deepLink) && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="sm" aria-label="Why?">
                    <HelpCircle className="h-4 w-4 mr-1" />
                    Why?
                  </Button>
                </PopoverTrigger>
                <PopoverContent>
                  {failedGate.remediation && <p className="text-sm">{failedGate.remediation}</p>}
                  {failedGate.deepLink && (
                    <a
                      href={failedGate.deepLink}
                      className="text-sm text-primary underline mt-2 inline-block"
                    >
                      Fix it now
                    </a>
                  )}
                </PopoverContent>
              </Popover>
            )}
          </>
        )}

        {installed && (
          <>
            {installed.updateAvailable && entry.registryVersion && (
              <Popover open={updatePopoverOpen} onOpenChange={setUpdatePopoverOpen}>
                <PopoverTrigger asChild>
                  <Button disabled={isUpdating}>{`Update to v${entry.registryVersion}`}</Button>
                </PopoverTrigger>
                <PopoverContent className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor={`prune-${entry.id}`} className="font-normal">
                      Reset to the app&apos;s shipped rules (prune)
                    </Label>
                    <Switch
                      id={`prune-${entry.id}`}
                      checked={prune}
                      onCheckedChange={setPrune}
                    />
                  </div>
                  <Button className="w-full" onClick={handleConfirmUpdate} disabled={isUpdating}>
                    {isUpdating ? 'Starting…' : 'Confirm update'}
                  </Button>
                </PopoverContent>
              </Popover>
            )}

            {installed.appUrl && (
              <Button asChild variant={installed.updateAvailable ? 'outline' : 'default'}>
                <a href={installed.appUrl} target="_blank" rel="noopener noreferrer">
                  Open
                  <ExternalLink className="h-4 w-4 ml-1" />
                </a>
              </Button>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="More actions">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setUninstallOpen(true)}>Uninstall</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setEjectOpen(true)}>Eject</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <UninstallDialog entry={entry} open={uninstallOpen} onOpenChange={setUninstallOpen} />
            <EjectPanel entry={entry} open={ejectOpen} onOpenChange={setEjectOpen} />
          </>
        )}
      </CardFooter>
    </Card>
  );
}
