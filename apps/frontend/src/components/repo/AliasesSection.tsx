import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Tag, ExternalLink, Network } from 'lucide-react';
import { CommitAlias } from '../../services/repoApi';
import { formatDistanceToNow } from 'date-fns';
import { buildPreviewAliasUrl } from '@/lib/utils';
import { Badge } from '../ui/badge';

interface AliasesSectionProps {
  aliases: CommitAlias[];
}

function formatDate(dateString: string): string {
  try {
    return formatDistanceToNow(new Date(dateString), { addSuffix: true });
  } catch {
    return dateString;
  }
}

export function AliasesSection({ aliases }: AliasesSectionProps) {
  if (aliases.length === 0) return null;

  const manualAliases = aliases.filter((a) => !a.isAutoPreview);
  const previewAliases = aliases.filter((a) => a.isAutoPreview);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Tag className="h-5 w-5" />
          Aliases ({aliases.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Manual Aliases */}
        {manualAliases.length > 0 && (
          <div className="space-y-2">
            {previewAliases.length > 0 && (
              <h4 className="text-sm font-medium">Manual Aliases</h4>
            )}
            {manualAliases.map((alias) => (
              <AliasRow key={alias.name} alias={alias} />
            ))}
          </div>
        )}

        {/* Preview Aliases */}
        {previewAliases.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">
              Preview Aliases (auto-generated)
            </h4>
            {previewAliases.map((alias) => (
              <AliasRow key={alias.name} alias={alias} isPreview />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface AliasRowProps {
  alias: CommitAlias;
  isPreview?: boolean;
}

function AliasRow({ alias, isPreview = false }: AliasRowProps) {
  const previewUrl = buildPreviewAliasUrl(alias.name);

  return (
    <div className={`p-3 rounded-lg border ${isPreview ? 'bg-muted/30' : 'bg-accent/50'}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Tag className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <code className="text-sm truncate">{alias.name}</code>
          {alias.basePath && (
            <span className="text-xs text-muted-foreground truncate">({alias.basePath})</span>
          )}
          {alias.proxyRuleSetName && (
            <Badge variant="outline" className="flex-shrink-0 gap-1 text-xs">
              <Network className="h-3 w-3" />
              {alias.proxyRuleSetName}
            </Badge>
          )}
        </div>
        {isPreview && (
          <a
            href={previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-sm text-primary hover:underline flex-shrink-0"
          >
            <ExternalLink className="h-3 w-3" />
            Open
          </a>
        )}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        Created {formatDate(alias.createdAt)}
      </div>
    </div>
  );
}
