import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { ChevronRight, Settings } from 'lucide-react';
import { ManagedFromGitBadge } from '@/components/proxy-rules/ManagedFromGitBadge';
import type { ProxyRuleSetSource } from '@/services/proxyRulesApi';

interface RuleSetCardProps {
  id: string;
  name: string;
  description: string | null;
  environment: string | null;
  source?: ProxyRuleSetSource | null;
  isDefault: boolean;
  href: string;
}

/**
 * RuleSetCard - Clickable card displaying a proxy rule set.
 * Used in ProxyRuleSetsPage to navigate to rule set details.
 */
export function RuleSetCard({
  name,
  description,
  environment,
  source,
  isDefault,
  href,
}: RuleSetCardProps) {
  return (
    <Link
      to={href}
      className="flex items-center justify-between p-4 rounded-lg border hover:bg-accent transition-colors group"
    >
      {/* pr-9 keeps content clear of the actions menu the list page overlays at right-12 */}
      <div className="flex min-w-0 items-center gap-4 pr-9">
        <Settings className="h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{name}</span>
            {environment && (
              <Badge variant="outline" className="text-xs">
                {environment}
              </Badge>
            )}
            {isDefault && (
              <Badge variant="secondary" className="text-xs">
                Default
              </Badge>
            )}
            <ManagedFromGitBadge source={source} />
          </div>
          {description && (
            <p className="text-sm text-muted-foreground mt-1">{description}</p>
          )}
        </div>
      </div>

      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors" />
    </Link>
  );
}
