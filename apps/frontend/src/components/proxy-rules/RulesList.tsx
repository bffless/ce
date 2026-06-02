import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Trash2, Edit2, AlertCircle, ArrowRight, RotateCcw, Mail, Workflow, Bug } from 'lucide-react';
import type { ProxyRule, UpdateProxyRuleDto } from '@/services/proxyRulesApi';
import { useGetRuleLogCountQuery } from '@/services/proxyRulesApi';

interface RulesListProps {
  rules: ProxyRule[];
  isLoading: boolean;
  error?: unknown;
  onRuleClick: (rule: ProxyRule) => void;
  onUpdateRule: (id: string, updates: UpdateProxyRuleDto) => Promise<void>;
  onDeleteRule: (id: string) => Promise<void>;
  onViewLogs?: (rule: ProxyRule) => void;
  // When false, write actions (toggle, debug, edit, delete) are hidden so the
  // list reads as view-only for viewers/guests. Row click still works so they
  // can open the rule in the read-only editor.
  canEdit?: boolean;
}

/**
 * RulesList - Displays a list of proxy rules with toggle and delete actions.
 * Rules are clickable to navigate to edit page.
 */
/**
 * Small inline component to show log count badge for a pipeline rule.
 */
function LogCountBadge({ ruleId, onClick }: { ruleId: string; onClick: (e: React.MouseEvent) => void }) {
  const { data } = useGetRuleLogCountQuery(ruleId);
  if (!data || data.count === 0) return null;
  return (
    <Badge
      variant="secondary"
      className="cursor-pointer text-xs"
      onClick={onClick}
    >
      {data.count} run{data.count === 1 ? '' : 's'}
    </Badge>
  );
}

export function RulesList({
  rules,
  isLoading,
  error,
  onRuleClick,
  onUpdateRule,
  onDeleteRule,
  onViewLogs,
  canEdit = true,
}: RulesListProps) {
  const [deletingRule, setDeletingRule] = useState<ProxyRule | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Sort rules by order (lower = first)
  const sortedRules = [...rules].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const handleDelete = async () => {
    if (!deletingRule) return;
    setIsDeleting(true);
    try {
      await onDeleteRule(deletingRule.id);
      setDeletingRule(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleToggleEnabled = async (rule: ProxyRule, e: React.MouseEvent) => {
    e.stopPropagation();
    await onUpdateRule(rule.id, { isEnabled: !rule.isEnabled });
  };

  const handleDeleteClick = (rule: ProxyRule, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingRule(rule);
  };

  const handleEditClick = (rule: ProxyRule, e: React.MouseEvent) => {
    e.stopPropagation();
    onRuleClick(rule);
  };

  const handleToggleDebug = async (rule: ProxyRule, e: React.MouseEvent) => {
    e.stopPropagation();
    await onUpdateRule(rule.id, { debugEnabled: !rule.debugEnabled });
  };

  const handleViewLogs = (rule: ProxyRule, e: React.MouseEvent) => {
    e.stopPropagation();
    onViewLogs?.(rule);
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-2">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Failed to load proxy rules. {(error as { data?: { message?: string } })?.data?.message || 'Unknown error'}
        </AlertDescription>
      </Alert>
    );
  }

  // Empty state
  if (sortedRules.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">No proxy rules configured.</p>
        <p className="text-sm text-muted-foreground mt-2">
          Add a rule to forward requests matching specific paths to external backends.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2">
        {sortedRules.map((rule) => (
          <div
            key={rule.id}
            onClick={() => onRuleClick(rule)}
            className={`flex items-center gap-3 p-3 border rounded-md bg-background transition-colors cursor-pointer hover:bg-accent ${
              !rule.isEnabled ? 'opacity-50' : ''
            }`}
          >
            <div
              className="flex items-center justify-center w-6 h-6 rounded bg-muted text-xs font-mono flex-shrink-0"
              title="Priority order (lower = first)"
            >
              {rule.order}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-sm">
                <code className="font-mono bg-muted px-2 py-0.5 rounded truncate">
                  {rule.pathPattern}
                </code>
                {rule.proxyType === 'email_form_handler' ? (
                  <span title="Email form handler">
                    <Mail className="h-3 w-3 text-emerald-500 flex-shrink-0" />
                  </span>
                ) : rule.proxyType === 'pipeline' ? (
                  <span title="Pipeline">
                    <Workflow className="h-3 w-3 text-purple-500 flex-shrink-0" />
                  </span>
                ) : rule.internalRewrite ? (
                  <span title="Internal rewrite">
                    <RotateCcw className="h-3 w-3 text-blue-500 flex-shrink-0" />
                  </span>
                ) : (
                  <ArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                )}
                <span className="text-muted-foreground truncate">
                  {rule.proxyType === 'email_form_handler'
                    ? rule.emailHandlerConfig?.destinationEmail || 'No email configured'
                    : rule.proxyType === 'pipeline'
                      ? rule.pipelineConfig?.name || 'Pipeline'
                      : rule.targetUrl}
                </span>
                {rule.proxyType === 'email_form_handler' && (
                  <span className="text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300 px-1.5 py-0.5 rounded flex-shrink-0">
                    email
                  </span>
                )}
                {rule.proxyType === 'pipeline' && (
                  <span className="text-xs bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300 px-1.5 py-0.5 rounded flex-shrink-0">
                    pipeline
                  </span>
                )}
                {rule.internalRewrite && (
                  <span className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 px-1.5 py-0.5 rounded flex-shrink-0">
                    rewrite
                  </span>
                )}
              </div>
              {rule.description && (
                <p className="text-xs text-muted-foreground mt-1 truncate">
                  {rule.description}
                </p>
              )}
              <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                {rule.proxyType === 'email_form_handler' ? (
                  <>
                    <span>Sends form data to email</span>
                    {rule.emailHandlerConfig?.honeypotField && <span>Spam protection</span>}
                  </>
                ) : rule.proxyType === 'pipeline' ? (
                  <>
                    <span>
                      {rule.pipelineConfig?.steps?.length
                        ? `${rule.pipelineConfig.steps.length} step${rule.pipelineConfig.steps.length === 1 ? '' : 's'}`
                        : 'No steps configured'}
                    </span>
                  </>
                ) : rule.internalRewrite ? (
                  <span>Internal rewrite (no HTTP request)</span>
                ) : (
                  <>
                    {rule.stripPrefix && <span>Strip prefix</span>}
                    <span>Timeout: {rule.timeout}ms</span>
                  </>
                )}
              </div>
            </div>
            {rule.proxyType === 'pipeline' && rule.debugEnabled && (
              <LogCountBadge
                ruleId={rule.id}
                onClick={(e) => handleViewLogs(rule, e)}
              />
            )}
            {canEdit && (
              <>
                {rule.proxyType === 'pipeline' && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => handleToggleDebug(rule, e)}
                    title={rule.debugEnabled ? 'Disable debug logging' : 'Enable debug logging'}
                    className={rule.debugEnabled ? 'text-purple-500' : ''}
                  >
                    <Bug className="h-4 w-4" />
                  </Button>
                )}
                <Switch
                  checked={rule.isEnabled}
                  onCheckedChange={() => {}}
                  onClick={(e) => handleToggleEnabled(rule, e)}
                  title={rule.isEnabled ? 'Disable rule' : 'Enable rule'}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => handleEditClick(rule, e)}
                  title="Edit rule"
                >
                  <Edit2 className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => handleDeleteClick(rule, e)}
                  title="Delete rule"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deletingRule} onOpenChange={(open) => !open && setDeletingRule(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Proxy Rule</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the proxy rule for{' '}
              <code className="font-mono bg-muted px-1 rounded">{deletingRule?.pathPattern}</code>?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
