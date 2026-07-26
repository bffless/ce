/**
 * Keeps `document.title` in sync with the current URL.
 *
 * `PageTitleProvider` renders a single effect that recomputes the title from
 * `useLocation()`, so client-side navigations (pushState/replaceState/back) all
 * update the tab title — no per-page wiring required. Titles come from the route
 * map in `@/lib/pageTitle` and are suffixed with the brandable site name.
 *
 * A page can supply a richer title once its data has loaded by calling
 * `useDocumentTitle` (@/hooks/useDocumentTitle).
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useBranding } from '@/hooks/useBranding';
import { PageTitleContext, type SetTitleOverride } from '@/hooks/useDocumentTitle';
import { formatDocumentTitle, getRouteTitleParts } from '@/lib/pageTitle';

interface Override {
  id: string;
  parts: string[];
}

function DocumentTitleEffect({ override }: { override: string[] | null }) {
  const { pathname, search } = useLocation();
  const { siteName } = useBranding();

  useEffect(() => {
    const parts = override ?? getRouteTitleParts(pathname, new URLSearchParams(search));
    document.title = formatDocumentTitle(parts, siteName);
  }, [override, pathname, search, siteName]);

  return null;
}

export function PageTitleProvider({ children }: { children: ReactNode }) {
  const [overrides, setOverrides] = useState<Override[]>([]);

  const setOverride = useCallback<SetTitleOverride>((id, parts) => {
    setOverrides((current) => {
      const rest = current.filter((entry) => entry.id !== id);
      return parts && parts.length > 0 ? [...rest, { id, parts }] : rest;
    });
  }, []);

  const active = overrides.length > 0 ? overrides[overrides.length - 1].parts : null;

  return (
    <PageTitleContext.Provider value={setOverride}>
      <DocumentTitleEffect override={active} />
      {children}
    </PageTitleContext.Provider>
  );
}
