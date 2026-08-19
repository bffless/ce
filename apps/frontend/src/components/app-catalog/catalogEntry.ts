import type { CatalogEntry, InstalledSummary } from '@/services/appCatalogApi';

/**
 * True when the details view has something to show: store metadata from the
 * registry (description / screenshots), or at least one install — the
 * details dialog is also where the per-install list lives, so an installed
 * app always has a details view even when it was published without a
 * `catalog/` dir or has since been de-listed. Shared so `AppCard` renders its
 * "Details" affordance under exactly the same condition `AppDetailsDialog`
 * would render content for.
 */
export function hasAppDetails(entry: CatalogEntry): boolean {
  return Boolean(entry.description || entry.screenshots?.length || entry.installs.length > 0);
}

/** Installs that can move to the registry version right now. */
export function updatableInstalls(entry: CatalogEntry): InstalledSummary[] {
  if (!entry.registryVersion) return [];
  return entry.installs.filter((install) => install.updateAvailable);
}

/** Pulls the host out of an install's URL for compact display (`files.example.com`). */
export function installHost(install: InstalledSummary): string | undefined {
  if (!install.appUrl) return undefined;
  try {
    return new URL(install.appUrl).host;
  } catch {
    return undefined;
  }
}
