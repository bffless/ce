import { useState } from 'react';
import { AppCard } from '@/components/app-catalog/AppCard';
import { InstallDialog } from '@/components/app-catalog/InstallDialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useGetAppCatalogQuery, type CatalogEntry } from '@/services/appCatalogApi';
import { AlertTriangle, LayoutGrid, X } from 'lucide-react';

/**
 * AppsPage — the app catalog admin page (Task 12 of the app-catalog spec).
 * Lists every app the registry knows about, each rendered as an `AppCard`
 * with its own install/manage CTA. Registry fetch failures don't block the
 * page — already-installed apps still render (`registryError` becomes a
 * dismissable notice instead of an error state).
 */
export function AppsPage() {
  const { data, isLoading, isError, refetch } = useGetAppCatalogQuery();
  const [registryNoticeDismissed, setRegistryNoticeDismissed] = useState(false);
  const [installTarget, setInstallTarget] = useState<CatalogEntry | null>(null);
  const [updateTarget, setUpdateTarget] = useState<{ entry: CatalogEntry; jobId: string } | null>(
    null,
  );

  const entries = data?.data ?? [];

  return (
    <div className="container mx-auto py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Apps</h1>
        <p className="text-muted-foreground mt-1">
          1-click install apps built on top of BFFless
        </p>
      </div>

      {data?.registryError && !registryNoticeDismissed && (
        <Alert className="mb-6">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle className="flex items-start justify-between gap-3">
            <span>Catalog unavailable — installed apps unaffected</span>
            <button
              onClick={() => setRegistryNoticeDismissed(true)}
              aria-label="Dismiss"
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </AlertTitle>
          <AlertDescription>{data.registryError}</AlertDescription>
        </Alert>
      )}

      {isLoading && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      )}

      {isError && !isLoading && (
        <Alert variant="destructive">
          <AlertDescription>
            Failed to load the app catalog.{' '}
            <Button variant="link" className="p-0 h-auto" onClick={() => refetch()}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!isLoading && !isError && entries.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <LayoutGrid className="h-10 w-10 text-muted-foreground mb-3" />
          <h2 className="text-lg font-semibold">No apps available</h2>
          <p className="text-muted-foreground mt-1 max-w-sm">
            The app catalog is empty right now — check back later.
          </p>
        </div>
      )}

      {!isLoading && entries.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {entries.map((entry) => (
            <AppCard
              key={entry.id}
              entry={entry}
              onInstall={setInstallTarget}
              onUpdateStarted={(updatedEntry, jobId) => setUpdateTarget({ entry: updatedEntry, jobId })}
            />
          ))}
        </div>
      )}

      {installTarget && (
        <InstallDialog
          entry={installTarget}
          open={installTarget !== null}
          onOpenChange={(open) => !open && setInstallTarget(null)}
        />
      )}

      {updateTarget && (
        <InstallDialog
          entry={updateTarget.entry}
          open={updateTarget !== null}
          onOpenChange={(open) => !open && setUpdateTarget(null)}
          mode="update"
          initialJobId={updateTarget.jobId}
        />
      )}
    </div>
  );
}
