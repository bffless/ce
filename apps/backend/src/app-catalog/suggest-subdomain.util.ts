/**
 * suggestSubdomain — picks a free subdomain for a SECOND install of an app
 * whose manifest-default host is already taken (typically by the same app's
 * install in another project). Pure apart from the injected `isTaken` probe,
 * so the candidate walk is unit-testable without a database.
 *
 * Candidates: `<default>-<project>` (project name slugified), then
 * `<default>-<project>-2`, `-3`, … up to `maxAttempts`. Reserved subdomains
 * are skipped the same way the preflight gate would reject them. Returns
 * `undefined` when nothing free turns up — the wizard then falls back to the
 * plain collision message and the operator types one.
 */
export interface SuggestSubdomainInput {
  defaultSubdomain: string;
  projectName: string;
  /** True when the candidate is already in use as a host or an alias anywhere on the instance. */
  isTaken: (subdomain: string) => Promise<boolean>;
  isReserved: (subdomain: string) => boolean;
  maxAttempts?: number;
}

export async function suggestSubdomain(input: SuggestSubdomainInput): Promise<string | undefined> {
  const { defaultSubdomain, projectName, isTaken, isReserved, maxAttempts = 10 } = input;
  const base = trimSlug(`${slugify(defaultSubdomain)}-${slugify(projectName)}`);
  if (!base) return undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const candidate = attempt === 1 ? base : `${base}-${attempt}`;
    if (isReserved(candidate)) continue;
    if (!(await isTaken(candidate))) return candidate;
  }
  return undefined;
}

/** Lower-case, non [a-z0-9] runs → single '-', no leading/trailing '-'. */
export function slugify(value: string): string {
  return trimSlug(value.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
}

function trimSlug(value: string): string {
  return value.replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
}
