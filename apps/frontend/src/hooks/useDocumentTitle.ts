/**
 * Per-page override for the route-derived document title.
 *
 * The title itself is written by `PageTitleProvider`
 * (@/components/DocumentTitle), which owns the context this hook writes into.
 */
import { createContext, useContext, useEffect, useId } from 'react';

export type SetTitleOverride = (id: string, parts: string[] | null) => void;

/** Nullable entries are dropped, so callers can pass values that are still loading. */
export type TitleInput = string | Array<string | null | undefined> | null | undefined;

export const PageTitleContext = createContext<SetTitleOverride | null>(null);

/**
 * Separator used to key the effect on the parts' *contents* rather than the
 * array's identity. A control character, so it can never occur in a title.
 */
const KEY_SEPARATOR = '\u0000';

/**
 * Override the route-derived document title for as long as the calling
 * component is mounted. The most recently registered override wins, and it is
 * dropped automatically on unmount.
 *
 * Pass `null`/`undefined` while the data needed for the title is still loading —
 * the route-derived title (see `@/lib/pageTitle`) is used until then.
 *
 * @example
 * useDocumentTitle(ruleSet ? [ruleSet.name, 'Proxy Rules', `${owner}/${repo}`] : null);
 */
export function useDocumentTitle(title: TitleInput): void {
  const setOverride = useContext(PageTitleContext);
  const id = useId();

  const parts = (Array.isArray(title) ? title : [title]).filter(
    (part): part is string => typeof part === 'string' && part.length > 0,
  );
  // Depend on the joined value so callers can pass a fresh array every render.
  const key = parts.join(KEY_SEPARATOR);

  useEffect(() => {
    if (!setOverride) return;

    setOverride(id, key ? key.split(KEY_SEPARATOR) : null);
    return () => setOverride(id, null);
  }, [id, key, setOverride]);
}
