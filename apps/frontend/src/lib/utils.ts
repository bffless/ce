import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Formats a file size in bytes to a human-readable string
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
}

/**
 * Alias for formatFileSize for consistency with API
 */
export function formatStorageSize(bytes: number): string {
  return formatFileSize(bytes);
}

/**
 * Formats a date string to a relative time string (e.g., "2 hours ago")
 */
export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) {
    return 'just now';
  }

  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) {
    return `${diffInMinutes} ${diffInMinutes === 1 ? 'minute' : 'minutes'} ago`;
  }

  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) {
    return `${diffInHours} ${diffInHours === 1 ? 'hour' : 'hours'} ago`;
  }

  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays < 30) {
    return `${diffInDays} ${diffInDays === 1 ? 'day' : 'days'} ago`;
  }

  const diffInMonths = Math.floor(diffInDays / 30);
  if (diffInMonths < 12) {
    return `${diffInMonths} ${diffInMonths === 1 ? 'month' : 'months'} ago`;
  }

  const diffInYears = Math.floor(diffInMonths / 12);
  return `${diffInYears} ${diffInYears === 1 ? 'year' : 'years'} ago`;
}

/**
 * Checks if a gitRef is a commit SHA (40 hexadecimal characters)
 * @param gitRef - A git reference (SHA or alias)
 * @returns true if the gitRef is a 40-character hex string (SHA)
 */
export function isCommitSha(gitRef: string): boolean {
  return /^[a-f0-9]{40}$/i.test(gitRef);
}

/**
 * Builds the correct public URL path segment for a git reference
 * - SHAs use: /commits/{sha}/
 * - Aliases use: /alias/{alias}/
 * @param gitRef - A git reference (SHA or alias)
 * @returns The URL path segment (e.g., "commits/abc123..." or "alias/main")
 */
export function getPublicUrlPath(gitRef: string): string {
  return isCommitSha(gitRef) ? `commits/${gitRef}` : `alias/${gitRef}`;
}

/**
 * Builds the full public URL for a file
 * @param baseUrl - The API base URL (can be empty for relative URLs)
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param gitRef - Git reference (SHA or alias)
 * @param filepath - Optional file path within the deployment
 * @returns The complete public URL
 */
export function buildPublicUrl(
  baseUrl: string,
  owner: string,
  repo: string,
  gitRef: string,
  filepath?: string
): string {
  const refPath = getPublicUrlPath(gitRef);
  const base = `${baseUrl}/public/${owner}/${repo}/${refPath}`;
  return filepath ? `${base}/${filepath}` : base;
}

/**
 * Get the primary domain for preview alias URLs.
 * In production, derives from current hostname (removes first subdomain).
 * Can be overridden via VITE_PRIMARY_DOMAIN env var.
 */
export function getPrimaryDomain(): string {
  const envDomain = import.meta.env.VITE_PRIMARY_DOMAIN;
  if (envDomain) return envDomain;

  // Fall back to current hostname without the first subdomain
  // e.g., admin.console.workspace.sahp.app -> console.workspace.sahp.app
  const hostname = window.location.hostname;
  const parts = hostname.split('.');
  if (parts.length > 2) {
    return parts.slice(1).join('.');
  }
  return hostname;
}

/**
 * Build a preview alias URL for the given alias and path.
 * In development, uses path-based URL to backend.
 * In production, uses wildcard subdomain URL.
 */
export function buildPreviewAliasUrl(
  aliasName: string,
  relativePath?: string
): string {
  if (import.meta.env.DEV) {
    const backendUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
    const path = relativePath ? `/${relativePath}` : '/';
    return `${backendUrl}/public/subdomain-alias/${aliasName}${path}`;
  }
  const primaryDomain = getPrimaryDomain();
  const path = relativePath ? `/${relativePath}` : '/';
  return `https://${aliasName}.${primaryDomain}${path}`;
}
