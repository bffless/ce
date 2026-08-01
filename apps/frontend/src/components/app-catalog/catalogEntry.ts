import type { CatalogEntry } from '@/services/appCatalogApi';

/**
 * True when the registry gave this app enough store metadata to be worth a
 * details view. Shared so `AppCard` renders its "Details" affordance under
 * exactly the same condition `AppDetailsDialog` would render content for — an
 * app with neither a description nor screenshots (a de-listed installed app,
 * or one published without a `catalog/` dir) gets no dead-end button.
 */
export function hasAppDetails(entry: CatalogEntry): boolean {
  return Boolean(entry.description || entry.screenshots?.length);
}
