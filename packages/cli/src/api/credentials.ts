/**
 * Credential store for `bffless login` — `$XDG_CONFIG_HOME/bffless/credentials.json`
 * (default `~/.config/bffless/credentials.json`), mode 0600, written atomically.
 *
 * Keys are stored OUTSIDE any repo, keyed by normalized API URL, so the client.ts
 * invariant holds: API keys are never read from a repo-committed file. Resolution
 * precedence stays flag > env > (this store) — see createClient.
 *
 * A present-but-broken file is a hard error naming the path (same stance as
 * config.ts): silently treating it as "no credentials" would send the user down a
 * confusing "why am I logged out" path instead of "your file is corrupt".
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

export const CredentialsFileSchema = z
  .object({
    version: z.literal(1),
    credentials: z.record(
      z.object({ apiKey: z.string().min(1), createdAt: z.string() }).strict(),
    ),
  })
  .strict();
export type CredentialsFile = z.infer<typeof CredentialsFileSchema>;

/** Default store location, honouring `$XDG_CONFIG_HOME`. */
export function credentialsPath(env: Record<string, string | undefined> = process.env): string {
  const base =
    env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.length > 0
      ? env.XDG_CONFIG_HOME
      : path.join(os.homedir(), '.config');
  return path.join(base, 'bffless', 'credentials.json');
}

/** Canonical store key for an instance URL: URL-parsed (lowercased host), trailing slashes stripped. */
export function normalizeApiUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`invalid API URL: "${raw}" — expected e.g. https://admin.example.com`);
  }
  const pathname = url.pathname.replace(/\/+$/, '');
  return `${url.protocol}//${url.host}${pathname}`;
}

/** Parse the store. `null` when the file does not exist; throws (naming the path) when broken. */
export function readCredentialsFile(file: string): CredentialsFile | null {
  if (!existsSync(file)) return null;
  const raw = readFileSync(file, 'utf8');
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${file}: invalid JSON — ${(err as Error).message}`);
  }
  const result = CredentialsFileSchema.safeParse(data);
  if (!result.success) {
    throw new Error(
      `${file}: does not match the credentials schema — fix or delete the file and run \`bffless login\` again`,
    );
  }
  return result.data;
}

export function getStoredKey(apiUrl: string, file: string = credentialsPath()): string | undefined {
  return readCredentialsFile(file)?.credentials[normalizeApiUrl(apiUrl)]?.apiKey;
}

export function storeKey(
  apiUrl: string,
  apiKey: string,
  file: string = credentialsPath(),
  now: Date = new Date(),
): void {
  const store = readCredentialsFile(file) ?? { version: 1 as const, credentials: {} };
  store.credentials[normalizeApiUrl(apiUrl)] = { apiKey, createdAt: now.toISOString() };
  writeCredentialsFile(file, store);
}

/** Remove an instance's entry. Returns whether anything was removed. */
export function removeKey(apiUrl: string, file: string = credentialsPath()): boolean {
  const store = readCredentialsFile(file);
  const key = normalizeApiUrl(apiUrl);
  if (!store || !(key in store.credentials)) return false;
  delete store.credentials[key];
  writeCredentialsFile(file, store);
  return true;
}

/** Atomic write (temp + rename), file 0600, parent dir 0700. */
function writeCredentialsFile(file: string, data: CredentialsFile): void {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, file);
  chmodSync(file, 0o600);
}
