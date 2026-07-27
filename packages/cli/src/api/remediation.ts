/**
 * Remediation wording — the "here's how to fix it" half of a configuration/auth error.
 *
 * The library's default text names CLI affordances (`--api-key`, `BFFLESS_API_KEY`,
 * `.bffless/config.json`). That is right for `bffless rules push` and wrong for every other
 * embedder of `bffless/lib`: the deploy-proxy-rules GitHub Action, for instance, has no
 * flags and no committed config — its user sets an `api-key` *input*. Telling that user to
 * "pass --api-key" sends them looking for a flag that does not exist.
 *
 * So the wording is data, not string literals baked into throw sites: pass
 * `deps.remediation` to override any subset of it (see `ClientDeps`).
 */
export interface Remediation {
  /** No API URL could be resolved from flags, env, or config. */
  apiUrl: string;
  /** No API key could be resolved from flags or env. */
  apiKey: string;
  /** No project was named by a flag or by config. */
  project: string;
  /** The API rejected the key (HTTP 401/403). */
  auth: string;
}

/** Default wording, phrased for someone running the `bffless` CLI. */
export const CLI_REMEDIATION: Remediation = {
  apiUrl: 'pass --api-url, set BFFLESS_API_URL, or add "apiUrl" to .bffless/config.json',
  apiKey:
    'pass --api-key, set BFFLESS_API_KEY, or run `bffless login` (API keys are never read ' +
    'from .bffless/config.json, which is committed to the repo)',
  project: 'pass --project <uuid|owner/name|name> or add "project" to .bffless/config.json',
  auth:
    'The API key is sent as the X-API-Key header — pass --api-key, set BFFLESS_API_KEY, or ' +
    'run `bffless login` with a key that has access to this project.',
};

/** Fill any unspecified field from {@link CLI_REMEDIATION}. */
export function resolveRemediation(overrides?: Partial<Remediation>): Remediation {
  return overrides ? { ...CLI_REMEDIATION, ...overrides } : CLI_REMEDIATION;
}
