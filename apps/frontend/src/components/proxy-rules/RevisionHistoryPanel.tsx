import { useState } from 'react';
import { ChevronDown, ChevronRight, GitBranch, History as HistoryIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { formatRelativeTime } from '@/lib/utils';
import {
  useGetRuleSetRevisionsQuery,
  useRollbackRuleSetMutation,
  type RuleSetRevisionListItem,
} from '@/services/proxyRulesApi';

interface RevisionHistoryPanelProps {
  ruleSetId: string;
  // Hides Restore actions for viewers/guests, mirroring RulesList's canEdit gate.
  canEdit?: boolean;
}

// `repo@shortSha` fragment, matching ManagedFromGitBadge's origin formatting.
function revisionOrigin(source: RuleSetRevisionListItem['source']): string | undefined {
  if (!source) return undefined;
  const shortSha = source.gitSha ? source.gitSha.slice(0, 7) : undefined;
  if (source.repo && shortSha) return `${source.repo}@${shortSha}`;
  return source.repo || (shortSha ? `@${shortSha}` : undefined);
}

function summarizeSyncResult(result: {
  created: unknown[];
  updated: unknown[];
  deleted: unknown[];
}): string {
  return `${result.created.length} created, ${result.updated.length} updated, ${result.deleted.length} deleted.`;
}

/**
 * RevisionHistoryPanel - Collapsible revision history for a rule set, with
 * restore-to-revision support. Revisions arrive newest-first from the server
 * (`GET /api/proxy-rule-sets/:id/revisions`) and are rendered as-is.
 */
export function RevisionHistoryPanel({ ruleSetId, canEdit = true }: RevisionHistoryPanelProps) {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const { data, isLoading } = useGetRuleSetRevisionsQuery(ruleSetId);
  const [rollbackRuleSet, { isLoading: isRestoring }] = useRollbackRuleSetMutation();
  const [restoreTarget, setRestoreTarget] = useState<RuleSetRevisionListItem | null>(null);

  const revisions = data?.revisions ?? [];

  const handleRestore = async () => {
    if (!restoreTarget) return;
    try {
      const result = await rollbackRuleSet({
        id: ruleSetId,
        revisionId: restoreTarget.id,
      }).unwrap();
      toast({
        title: 'Rule set restored',
        description: summarizeSyncResult(result),
      });
      setRestoreTarget(null);
    } catch (err: unknown) {
      const errorMessage =
        (err as { data?: { message?: string } })?.data?.message || 'Failed to restore this revision';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  return (
    <>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-2 -ml-2 text-muted-foreground">
            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <HistoryIcon className="h-4 w-4" />
            History
            {revisions.length > 0 && (
              <Badge variant="secondary" className="text-xs font-normal">
                {revisions.length}
              </Badge>
            )}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-2">Loading revisions…</p>
          ) : revisions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No revisions captured yet.</p>
          ) : (
            <div className="space-y-2 pt-2">
              {revisions.map((revision) => {
                const origin = revisionOrigin(revision.source);
                return (
                  <div
                    key={revision.id}
                    data-testid="revision-row"
                    className="flex items-center gap-3 p-3 border rounded-md bg-background"
                  >
                    <div className="flex-1 min-w-0 text-sm">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span>{formatRelativeTime(revision.createdAt)}</span>
                        <Badge variant="outline" className="text-xs font-normal">
                          {revision.trigger}
                        </Badge>
                        <span className="text-muted-foreground text-xs">
                          {revision.ruleCount} rule{revision.ruleCount === 1 ? '' : 's'}
                        </span>
                        {origin && (
                          <span className="text-muted-foreground text-xs flex items-center gap-1">
                            <GitBranch className="h-3 w-3 shrink-0" aria-hidden="true" />
                            {origin}
                          </span>
                        )}
                        {revision.current && (
                          <Badge variant="secondary" className="text-xs">
                            Current
                          </Badge>
                        )}
                      </div>
                    </div>
                    {canEdit && !revision.current && (
                      <Button variant="outline" size="sm" onClick={() => setRestoreTarget(revision)}>
                        Restore
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>

      {/* Restore Confirmation Dialog */}
      <AlertDialog open={!!restoreTarget} onOpenChange={(open) => !open && setRestoreTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this revision?</AlertDialogTitle>
            <AlertDialogDescription>
              Restores this rule set to the state captured{' '}
              {restoreTarget ? formatRelativeTime(restoreTarget.createdAt) : ''}. Rules added since
              will be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRestoring}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRestore} disabled={isRestoring}>
              {isRestoring ? 'Restoring…' : 'Confirm restore'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
