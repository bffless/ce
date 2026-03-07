import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { ChevronRight, Settings } from 'lucide-react';

interface RuleSetCardProps {
  id: string;
  name: string;
  description: string | null;
  environment: string | null;
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
  isDefault,
  href,
}: RuleSetCardProps) {
  return (
    <Link
      to={href}
      className="flex items-center justify-between p-4 rounded-lg border hover:bg-accent transition-colors group"
    >
      <div className="flex items-center gap-4">
        <Settings className="h-5 w-5 text-muted-foreground" />
        <div>
          <div className="flex items-center gap-2">
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
          </div>
          {description && (
            <p className="text-sm text-muted-foreground mt-1">{description}</p>
          )}
        </div>
      </div>

      <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
    </Link>
  );
}
