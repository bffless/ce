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
import { GateBlockedCta } from './GateBlockedCta';
import { RemoteImage } from './RemoteImage';
import { SetupNotes } from './SetupNotes';
import { hasAppDetails } from './catalogEntry';
import { ExternalLink, MoreVertical } from 'lucide-react';

interface AppCardProps {
  entry: CatalogEntry;
  /** Opens the install wizard dialog (Task 13/14) for this app. */
  onInstall: (entry: CatalogEntry) => void;
  /** Opens the read-only details dialog (description + screenshots). */
  onDetails: (entry: CatalogEntry) => void;
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
 *
 * An installed card also carries its app's setup notes (titles collapsed,
 * bodies expanding in place) — CE can't perform them, so they live where the
 * app lives rather than behind a one-shot dialog.
 *
 * - installed + update available → an additional primary "Update to
 *   v{registryVersion}" button that opens a confirm popover (prune toggle,
 *   default off) before firing the update — unless an instance gate fails, in
 *   which case the update is blocked by the same disabled gate CTA as install
 *   (the update job re-runs those gates and would refuse anyway).
 *
 * Uninstall and Eject are delegated to dedicated dialogs (`UninstallDialog`,
 * `EjectPanel`) that each load their own preview/payload data; Update fires
 * `useUpdateAppMutation` here and hands the job off to the shared
 * `InstallDialog` (mounted by the page) for progress.
 *
 * Store metadata from the registry (ce#590) rides on top: a `thumbnailUrl`
 * banner and a `category` badge here, with the long-form description and
 * screenshots one click away in `AppDetailsDialog`.
 */
export function AppCard({ entry, onInstall, onDetails, onUpdateStarted }: AppCardProps) {
  const { toast } = useToast();
  const { installed } = entry;
  const failedGate = entry.gates.find((gate) => gate.status === 'fail');
  const showDetails = hasAppDetails(entry);

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

  const banner = (
    <div className="aspect-video w-full overflow-hidden bg-muted">
      <RemoteImage
        src={entry.thumbnailUrl}
        alt=""
        className="h-full w-full object-cover"
        fallback={
          <div
            aria-hidden
            className="flex h-full w-full items-center justify-center text-4xl font-semibold text-muted-foreground/40"
          >
            {entry.name.slice(0, 1)}
          </div>
        }
      />
    </div>
  );

  return (
    <Card className="flex flex-col overflow-hidden">
      {/*
        The banner is unconditional so a grid row stays even — one card with a
        thumbnail next to one without would otherwise be twice the height. An
        app with no `thumbnailUrl` (or whose image this instance can't reach)
        gets a monogram plate instead. It doubles as the details affordance
        when there IS a details view; a clickable banner that opens nothing
        would be worse than a plain one.
      */}
      {showDetails ? (
        <button
          type="button"
          onClick={() => onDetails(entry)}
          aria-label={`${entry.name} details`}
          className="block w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          {banner}
        </button>
      ) : (
        banner
      )}

      <CardHeader className="flex-row items-start gap-3 space-y-0">
        <RemoteImage
          src={entry.iconUrl}
          alt=""
          className="h-10 w-10 shrink-0 rounded-md object-cover"
        />
        <div className="min-w-0">
          <h3 className="font-semibold leading-tight truncate">{entry.name}</h3>
          {entry.summary && (
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{entry.summary}</p>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex-1 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {entry.category && (
            <Badge variant="outline" className="capitalize">
              {entry.category}
            </Badge>
          )}
          {installed && <Badge variant="secondary">{`Installed · v${installed.version}`}</Badge>}
        </div>

        {/*
          Titles only, collapsed. The banner above is unconditional so the grid
          doesn't go ragged; two three-line bodies inline would reintroduce
          exactly that unevenness, permanently. Expanding is one click, and the
          notes are worth finding — before this they were reachable only by
          triggering an Update.
        */}
        {installed && <SetupNotes steps={installed.manualSteps} />}
      </CardContent>

      <CardFooter className="flex flex-wrap items-center gap-2">
        {/*
          Rendered first so it's the footer's tab stop before the primary CTA:
          reading about an app should come before committing to installing it.
          Also the only details affordance when the app has no thumbnail.
        */}
        {showDetails && (
          <Button variant="ghost" size="sm" onClick={() => onDetails(entry)}>
            Details
          </Button>
        )}

        {!installed && !failedGate && (
          <Button disabled={!entry.installable} onClick={() => onInstall(entry)}>
            Install
          </Button>
        )}

        {!installed && failedGate && <GateBlockedCta gate={failedGate} />}

        {installed && (
          <>
            {/*
              A failing instance gate blocks the update the same way it blocks
              an install — the job would refuse at its preflight step — so the
              Update CTA becomes the same disabled, explained button rather
              than an action that only fails after the user commits to it.
            */}
            {installed.updateAvailable && entry.registryVersion && failedGate && (
              <GateBlockedCta gate={failedGate} />
            )}

            {installed.updateAvailable && entry.registryVersion && !failedGate && (
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
