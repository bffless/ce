import { useState } from 'react';
import { AppCard } from './AppCard';
import { AppDetailsDialog } from './AppDetailsDialog';
import { InstallDialog } from './InstallDialog';
import type { CatalogEntry } from '@/services/appCatalogApi';

interface AppCatalogGridProps {
  /**
   * The apps to render. Pass the LIVE list from `useGetAppCatalogQuery` on
   * every render (sliced is fine) — the dialogs below re-resolve their target
   * out of it, so a stale array would freeze their contents.
   */
  entries: CatalogEntry[];
  /** Grid classes, so a host page can choose its own column count. */
  className?: string;
}

/**
 * AppCatalogGrid — the app-catalog tiles plus the three dialogs their CTAs
 * open (details, install wizard, update progress). Shared by the full `/apps`
 * page and the featured strip on the admin home page so both get identical
 * install/update/details behavior; each host page owns its own heading and
 * loading/empty/error chrome.
 */
export function AppCatalogGrid({
  entries,
  className = 'grid gap-4 md:grid-cols-2 lg:grid-cols-3',
}: AppCatalogGridProps) {
  // These hold the entry captured at open time — used only as an id lookup
  // key and as a fallback if the app disappears from the catalog while the
  // dialog is open. The dialog is actually handed the LIVE entry (derived
  // below from the current `entries`), not this snapshot: server-side
  // mutations like updateApp invalidate the `AppCatalog` tag and refetch the
  // catalog, and a stale snapshot here would never pick that up (the Done
  // screen's setup notes would appear stuck on the pre-update list).
  const [installTargetSnapshot, setInstallTargetSnapshot] = useState<CatalogEntry | null>(null);
  const [detailsTargetSnapshot, setDetailsTargetSnapshot] = useState<{
    entry: CatalogEntry;
    /** True when opened from the card's "Update all" CTA — arms the batch runner. */
    autoUpdateAll: boolean;
  } | null>(null);
  const [updateTargetSnapshot, setUpdateTargetSnapshot] = useState<{
    entry: CatalogEntry;
    jobId: string;
  } | null>(null);

  const installTarget = installTargetSnapshot
    ? (entries.find((e) => e.id === installTargetSnapshot.id) ?? installTargetSnapshot)
    : null;
  const detailsTarget = detailsTargetSnapshot
    ? (entries.find((e) => e.id === detailsTargetSnapshot.entry.id) ?? detailsTargetSnapshot.entry)
    : null;
  const updateTarget = updateTargetSnapshot
    ? {
        entry:
          entries.find((e) => e.id === updateTargetSnapshot.entry.id) ??
          updateTargetSnapshot.entry,
        jobId: updateTargetSnapshot.jobId,
      }
    : null;

  return (
    <>
      <div className={className}>
        {entries.map((entry) => (
          <AppCard
            key={entry.id}
            entry={entry}
            onInstall={setInstallTargetSnapshot}
            onDetails={(entry) => setDetailsTargetSnapshot({ entry, autoUpdateAll: false })}
            onUpdateAll={(entry) => setDetailsTargetSnapshot({ entry, autoUpdateAll: true })}
            onUpdateStarted={(updatedEntry, jobId) =>
              setUpdateTargetSnapshot({ entry: updatedEntry, jobId })
            }
          />
        ))}
      </div>

      {detailsTarget && (
        <AppDetailsDialog
          entry={detailsTarget}
          open={detailsTarget !== null}
          onOpenChange={(open) => !open && setDetailsTargetSnapshot(null)}
          // Hand off rather than stack: the details dialog closes and the
          // install wizard takes its place, so there's only ever one modal.
          onInstall={(entry) => {
            setDetailsTargetSnapshot(null);
            setInstallTargetSnapshot(entry);
          }}
          // The update-progress dialog stacks over the details dialog on
          // purpose: the per-install list is the context the operator came
          // from and is still useful (other rows) once the job finishes.
          onUpdateStarted={(updatedEntry, jobId) =>
            setUpdateTargetSnapshot({ entry: updatedEntry, jobId })
          }
          autoUpdateAll={detailsTargetSnapshot?.autoUpdateAll}
        />
      )}

      {installTarget && (
        <InstallDialog
          entry={installTarget}
          open={installTarget !== null}
          onOpenChange={(open) => !open && setInstallTargetSnapshot(null)}
        />
      )}

      {updateTarget && (
        <InstallDialog
          entry={updateTarget.entry}
          open={updateTarget !== null}
          onOpenChange={(open) => !open && setUpdateTargetSnapshot(null)}
          mode="update"
          initialJobId={updateTarget.jobId}
        />
      )}
    </>
  );
}
