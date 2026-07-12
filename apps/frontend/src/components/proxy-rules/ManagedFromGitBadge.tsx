import { GitBranch } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn, formatRelativeTime } from '@/lib/utils';
import type { ProxyRuleSetSource } from '@/services/proxyRulesApi';

/**
 * Warning shown when a user edits a git-managed rule set (decision 2 of the
 * proxy-rules-as-code plan): edits stay allowed and `source` is never
 * cleared — we only warn that the next deploy will overwrite manual changes.
 */
export const MANAGED_FROM_GIT_WARNING =
  'This rule set is managed from git — manual edits will be overwritten on the next deploy. ' +
  'Run bffless rules pull to keep this change.';

interface ManagedFromGitBadgeProps {
  source?: ProxyRuleSetSource | null;
  className?: string;
}

/**
 * ManagedFromGitBadge - Provenance badge for rule sets synced from git.
 *
 * Renders "Managed from git" with `repo@shortSha` (whichever parts are
 * present — a sync may carry only syncedAt/contentHash) and a relative
 * synced time. Renders nothing when the set has no `source`.
 */
export function ManagedFromGitBadge({ source, className }: ManagedFromGitBadgeProps) {
  if (!source) return null;

  const shortSha = source.gitSha ? source.gitSha.slice(0, 7) : undefined;
  const origin =
    source.repo && shortSha
      ? `${source.repo}@${shortSha}`
      : source.repo || (shortSha ? `@${shortSha}` : undefined);

  return (
    <Badge
      variant="outline"
      className={cn('text-xs font-normal gap-1 items-center', className)}
      title={MANAGED_FROM_GIT_WARNING}
    >
      <GitBranch className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span>Managed from git</span>
      {origin && <span className="text-muted-foreground">{origin}</span>}
      {source.syncedAt && (
        <span className="text-muted-foreground">
          synced {formatRelativeTime(source.syncedAt)}
        </span>
      )}
    </Badge>
  );
}
