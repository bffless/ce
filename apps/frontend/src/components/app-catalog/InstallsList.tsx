import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatRelativeTime } from '@/lib/utils';
import type { CatalogEntry, InstalledSummary } from '@/services/appCatalogApi';
import { EjectPanel } from './EjectPanel';
import { GateBlockedCta } from './GateBlockedCta';
import { InstallUpdateButton } from './InstallUpdateButton';
import { SetupNotes } from './SetupNotes';
import { UninstallDialog } from './UninstallDialog';
import { installHost, updatableInstalls } from './catalogEntry';
import { useSequentialUpdates, type SequentialUpdateState } from './useSequentialUpdates';
import { ExternalLink, Loader2, MoreVertical } from 'lucide-react';

interface InstallsListProps {
  entry: CatalogEntry;
  /** A single update started from one row — the parent shows its progress dialog. */
  onUpdateStarted: (entry: CatalogEntry, jobId: string) => void;
  /** Opens the update-progress dialog for an already-running/finished job (batch rows). */
  onViewJob: (entry: CatalogEntry, jobId: string) => void;
  /** Start the "update all" batch as soon as this mounts (the card's "Update all" CTA). */
  autoUpdateAll?: boolean;
}

/**
 * InstallsList — the per-install inventory for one catalog app: where it is
 * installed (project + host), which version each install is on and when it
 * last moved, and the per-install actions (Open, Update, Uninstall, Eject).
 * When two or more installs have an update it also offers "Update all", which
 * runs them one after another (`useSequentialUpdates`) and reports progress
 * inline on each row.
 */
export function InstallsList({
  entry,
  onUpdateStarted,
  onViewJob,
  autoUpdateAll,
}: InstallsListProps) {
  const { installs } = entry;
  const updatable = updatableInstalls(entry);
  const failedGate = entry.gates.find((gate) => gate.status === 'fail');
  const batch = useSequentialUpdates();
  const [prune, setPrune] = useState(false);

  // Arm the batch once, on first mount, when the caller asked for it — not on
  // every re-render the catalog refetch triggers while the batch is running.
  const armedRef = useRef(false);
  useEffect(() => {
    if (!autoUpdateAll || armedRef.current || failedGate) return;
    armedRef.current = true;
    batch.start(updatable, prune);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoUpdateAll]);

  const showBatchControls =
    updatable.length > 1 || batch.running || Object.keys(batch.states).length > 0;

  return (
    <section className="space-y-3" aria-label="Installs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {`Installed in ${installs.length} project${installs.length === 1 ? '' : 's'}`}
        </h3>
        {showBatchControls && !failedGate && entry.registryVersion && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Switch
                id={`prune-all-${entry.id}`}
                checked={prune}
                onCheckedChange={setPrune}
                disabled={batch.running}
              />
              <Label
                htmlFor={`prune-all-${entry.id}`}
                className="text-xs font-normal text-muted-foreground"
              >
                Reset to shipped rules (prune)
              </Label>
            </div>
            <Button
              size="sm"
              onClick={() => batch.start(updatable, prune)}
              disabled={batch.running || updatable.length === 0}
            >
              {batch.running ? (
                <>
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  Updating…
                </>
              ) : (
                `Update all (${updatable.length})`
              )}
            </Button>
          </div>
        )}
        {showBatchControls && failedGate && <GateBlockedCta gate={failedGate} />}
      </div>

      <ul className="divide-y rounded-md border" aria-label="Installed projects">
        {installs.map((install) => (
          <InstallRow
            key={install.installedAppId}
            entry={entry}
            install={install}
            batchState={batch.states[install.installedAppId]}
            batchRunning={batch.running}
            onUpdateStarted={onUpdateStarted}
            onViewJob={onViewJob}
          />
        ))}
      </ul>
    </section>
  );
}

interface InstallRowProps {
  entry: CatalogEntry;
  install: InstalledSummary;
  batchState?: SequentialUpdateState;
  batchRunning: boolean;
  onUpdateStarted: (entry: CatalogEntry, jobId: string) => void;
  onViewJob: (entry: CatalogEntry, jobId: string) => void;
}

function InstallRow({
  entry,
  install,
  batchState,
  batchRunning,
  onUpdateStarted,
  onViewJob,
}: InstallRowProps) {
  const [uninstallOpen, setUninstallOpen] = useState(false);
  const [ejectOpen, setEjectOpen] = useState(false);
  const host = installHost(install);

  return (
    <li className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{install.projectName}</span>
          <Badge variant="secondary">{`v${install.version}`}</Badge>
          {install.status !== 'installed' && <Badge variant="outline">{install.status}</Badge>}
          {batchState && <BatchBadge state={batchState} />}
        </div>
        <p className="text-xs text-muted-foreground">
          {host ? `${host} · ` : ''}
          {hasBeenUpdated(install)
            ? `updated ${formatRelativeTime(install.updatedAt)}`
            : `installed ${formatRelativeTime(install.installedAt)}`}
        </p>
        {batchState?.error && <p className="text-xs text-destructive">{batchState.error}</p>}
        <SetupNotes steps={install.manualSteps} />
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {batchState?.jobId && batchState.status !== 'queued' ? (
          <Button size="sm" variant="outline" onClick={() => onViewJob(entry, batchState.jobId!)}>
            {batchState.status === 'conflicts' ? 'Review conflicts' : 'View'}
          </Button>
        ) : (
          !batchRunning && (
            <InstallUpdateButton
              entry={entry}
              install={install}
              onUpdateStarted={onUpdateStarted}
              size="sm"
            />
          )
        )}

        {install.appUrl && (
          <Button asChild size="sm" variant="outline">
            <a href={install.appUrl} target="_blank" rel="noopener noreferrer">
              Open
              <ExternalLink className="ml-1 h-3.5 w-3.5" />
            </a>
          </Button>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`More actions for ${install.projectName}`}
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={batchRunning} onSelect={() => setUninstallOpen(true)}>
              Uninstall
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setEjectOpen(true)}>Eject</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <UninstallDialog
          entry={entry}
          install={install}
          open={uninstallOpen}
          onOpenChange={setUninstallOpen}
        />
        <EjectPanel entry={entry} install={install} open={ejectOpen} onOpenChange={setEjectOpen} />
      </div>
    </li>
  );
}

/**
 * The install job's final "record" step bumps `updated_at` a few ms after the
 * row was created, so a strict inequality would call every fresh install
 * "updated". Only a later update job moves it by more than this.
 */
function hasBeenUpdated(install: InstalledSummary): boolean {
  return Date.parse(install.updatedAt) - Date.parse(install.installedAt) > 60_000;
}

function BatchBadge({ state }: { state: SequentialUpdateState }) {
  switch (state.status) {
    case 'queued':
      return <Badge variant="outline">Queued</Badge>;
    case 'running':
      return (
        <Badge variant="outline">
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          Updating
        </Badge>
      );
    case 'succeeded':
      return <Badge variant="secondary">Updated</Badge>;
    case 'conflicts':
      return <Badge variant="secondary">Updated · conflicts</Badge>;
    case 'failed':
      return <Badge variant="destructive">Failed</Badge>;
  }
}
