import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { CatalogEntry } from '@/services/appCatalogApi';
import { UninstallDialog } from './UninstallDialog';
import { EjectPanel } from './EjectPanel';
import { GateBlockedCta } from './GateBlockedCta';
import { InstallUpdateButton } from './InstallUpdateButton';
import { RemoteImage } from './RemoteImage';
import { SetupNotes } from './SetupNotes';
import { hasAppDetails, updatableInstalls } from './catalogEntry';
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
  /**
   * Opens the details dialog with the sequential "update every install"
   * runner armed. Only offered when two or more installs have an update.
   */
  onUpdateAll: (entry: CatalogEntry) => void;
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
 * - installed in ONE project → "Installed · v{version}" badge, an "Open"
 *   link to `appUrl`, and an overflow menu (Install in another project,
 *   Uninstall, Eject).
 * - one install + update available → an additional primary "Update to
 *   v{registryVersion}" button (`InstallUpdateButton`: confirm popover with
 *   the prune toggle, default off) — unless an instance gate fails, in which
 *   case the update is blocked by the same disabled gate CTA as install (the
 *   update job re-runs those gates and would refuse anyway).
 * - installed in SEVERAL projects → "Installed in N projects" badge, an
 *   "Update all (k)" CTA when k installs have an update, and "Manage
 *   installs", which opens the details dialog's per-install list where
 *   Open/Update/Uninstall/Eject live for each row. The card itself never
 *   guesses which install an action should hit.
 *
 * Uninstall and Eject are delegated to dedicated dialogs (`UninstallDialog`,
 * `EjectPanel`) that each load their own preview/payload data for the install
 * they're handed; an update hands its job off to the shared `InstallDialog`
 * (mounted by the page) for progress.
 *
 * A single-install card also carries that install's setup notes (titles
 * collapsed, bodies expanding in place) — CE can't perform them, so they live
 * where the app lives rather than behind a one-shot dialog. With several
 * installs the notes are per install, in the details dialog.
 *
 * Store metadata from the registry (ce#590) rides on top: a `thumbnailUrl`
 * banner and a `category` badge here, with the long-form description and
 * screenshots one click away in `AppDetailsDialog`.
 */
export function AppCard({ entry, onInstall, onDetails, onUpdateStarted, onUpdateAll }: AppCardProps) {
  const { installs } = entry;
  // The card has room to act on ONE install. With several, it summarises and
  // hands off to the details dialog's per-install list.
  const soleInstall = installs.length === 1 ? installs[0] : undefined;
  const updatable = updatableInstalls(entry);
  const failedGate = entry.gates.find((gate) => gate.status === 'fail');
  const showDetails = hasAppDetails(entry);

  const [ejectOpen, setEjectOpen] = useState(false);
  const [uninstallOpen, setUninstallOpen] = useState(false);

  const installedBadge =
    installs.length === 0
      ? null
      : soleInstall
        ? `Installed · v${soleInstall.version}`
        : `Installed in ${installs.length} projects${updatable.length > 0 ? ` · ${updatable.length} update${updatable.length === 1 ? '' : 's'} available` : ''}`;

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
          {installedBadge && <Badge variant="secondary">{installedBadge}</Badge>}
        </div>

        {/*
          Titles only, collapsed. The banner above is unconditional so the grid
          doesn't go ragged; two three-line bodies inline would reintroduce
          exactly that unevenness, permanently. Expanding is one click, and the
          notes are worth finding — before this they were reachable only by
          triggering an Update.
        */}
        {soleInstall && <SetupNotes steps={soleInstall.manualSteps} />}
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

        {installs.length === 0 && !failedGate && (
          <Button disabled={!entry.installable} onClick={() => onInstall(entry)}>
            Install
          </Button>
        )}

        {installs.length === 0 && failedGate && <GateBlockedCta gate={failedGate} />}

        {soleInstall && (
          <>
            <InstallUpdateButton entry={entry} install={soleInstall} onUpdateStarted={onUpdateStarted} />

            {soleInstall.appUrl && (
              <Button asChild variant={soleInstall.updateAvailable ? 'outline' : 'default'}>
                <a href={soleInstall.appUrl} target="_blank" rel="noopener noreferrer">
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
                {/*
                  Installing again is deliberately behind the overflow: the
                  common action on an installed card is Open/Update, and a
                  second primary "Install" next to "Installed" reads as a bug.
                */}
                <DropdownMenuItem disabled={!entry.installable || Boolean(failedGate)} onSelect={() => onInstall(entry)}>
                  Install in another project
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setUninstallOpen(true)}>Uninstall</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setEjectOpen(true)}>Eject</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <UninstallDialog entry={entry} install={soleInstall} open={uninstallOpen} onOpenChange={setUninstallOpen} />
            <EjectPanel entry={entry} install={soleInstall} open={ejectOpen} onOpenChange={setEjectOpen} />
          </>
        )}

        {installs.length > 1 && (
          <>
            {/*
              Several installs: the card can't pick one to Open/Update, so it
              offers the batch action and a way into the per-install list.
            */}
            {updatable.length > 0 && !failedGate && (
              <Button onClick={() => onUpdateAll(entry)}>{`Update all (${updatable.length})`}</Button>
            )}
            {updatable.length > 0 && failedGate && <GateBlockedCta gate={failedGate} />}
            <Button variant={updatable.length > 0 ? 'outline' : 'default'} onClick={() => onDetails(entry)}>
              Manage installs
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="More actions">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={!entry.installable || Boolean(failedGate)} onSelect={() => onInstall(entry)}>
                  Install in another project
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </CardFooter>
    </Card>
  );
}
