import * as crypto from 'crypto';

/**
 * Generates a deterministic preview alias name.
 * Format: {shortSha}-{repoAbbrev}-{repoHash}-{basePathHash}
 * Example: ca996e-wsaopens-a7f3-7d2f
 *
 * The alias is deterministic: same inputs always produce the same output.
 * This allows idempotent re-uploads with the same basePath.
 */
export function generatePreviewAliasName(
  commitSha: string,
  repository: string,
  basePath: string,
): string {
  // First 6 chars of commit SHA
  const shortSha = commitSha.substring(0, 6).toLowerCase();

  // Abbreviate repo: first 8 chars (alphanumeric only) + 4 char hash of full path
  const [, repo] = repository.split('/');
  const repoPrefix = (repo || repository)
    .replace(/[^a-z0-9]/gi, '')
    .substring(0, 8)
    .toLowerCase();
  const repoHash = crypto
    .createHash('sha256')
    .update(repository)
    .digest('hex')
    .substring(0, 4);

  // Hash the basePath (normalized: remove trailing slashes, default to '/')
  const normalizedBasePath = (basePath || '/').replace(/\/+$/, '') || '/';
  const basePathHash = crypto
    .createHash('sha256')
    .update(normalizedBasePath)
    .digest('hex')
    .substring(0, 4);

  return `${shortSha}-${repoPrefix}-${repoHash}-${basePathHash}`;
}

/**
 * Validates if an alias name matches the preview alias pattern.
 * Pattern: 6 hex chars - alphanumeric - 4 hex chars - 4 hex chars
 */
export function isPreviewAliasPattern(aliasName: string): boolean {
  return /^[a-f0-9]{6}-[a-z0-9]+-[a-f0-9]{4}-[a-f0-9]{4}$/i.test(aliasName);
}
