import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
import { Trash2, Plus, Edit2, AlertCircle, ArrowRight } from 'lucide-react';
import type { ProxyRule, CreateProxyRuleDto, UpdateProxyRuleDto } from '@/services/proxyRulesApi';
import { ProxyRuleForm } from './ProxyRuleForm';

interface ProxyRulesEditorProps {
  rules: ProxyRule[];
  isLoading: boolean;
  error?: unknown;
  onCreateRule: (rule: CreateProxyRuleDto) => Promise<void>;
  onUpdateRule: (id: string, updates: UpdateProxyRuleDto) => Promise<void>;
  onDeleteRule: (id: string) => Promise<void>;
  onReorder: (ruleIds: string[]) => Promise<void>;
  scope: 'project' | 'alias';
}

export function ProxyRulesEditor({
  rules,
  isLoading,
  error,
  onCreateRule,
  onUpdateRule,
  onDeleteRule,
  onReorder: _onReorder,
  scope,
}: ProxyRulesEditorProps) {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<ProxyRule | null>(null);
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

  const handleToggleEnabled = async (rule: ProxyRule) => {
    await onUpdateRule(rule.id, { isEnabled: !rule.isEnabled });
  };

  // Loading state
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-80" />
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Proxy Rules {scope === 'project' ? '(Project Defaults)' : '(Alias Overrides)'}</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Failed to load proxy rules. {(error as { data?: { message?: string } })?.data?.message || 'Unknown error'}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>
                Proxy Rules {scope === 'project' ? '(Project Defaults)' : '(Alias Overrides)'}
              </CardTitle>
              <CardDescription>
                {scope === 'project'
                  ? 'These rules apply to all aliases and direct SHA URLs unless overridden at the alias level.'
                  : 'These rules override project defaults for this specific alias.'}
              </CardDescription>
            </div>
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Rule
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Create Proxy Rule</DialogTitle>
                  <DialogDescription>
                    Forward matching requests to an external backend endpoint.
                  </DialogDescription>
                </DialogHeader>
                <ProxyRuleForm
                  onSubmit={async (data) => {
                    await onCreateRule(data);
                    setIsCreateOpen(false);
                  }}
                  onCancel={() => setIsCreateOpen(false)}
                />
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {sortedRules.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">No proxy rules configured.</p>
              <p className="text-sm text-muted-foreground mt-2">
                Add a rule to forward requests matching specific paths to external backends.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {sortedRules.map((rule) => (
                <div
                  key={rule.id}
                  className={`flex items-center gap-3 p-3 border rounded-md bg-background transition-colors ${
                    !rule.isEnabled ? 'opacity-50' : ''
                  }`}
                >
                  <div className="flex items-center justify-center w-6 h-6 rounded bg-muted text-xs font-mono flex-shrink-0" title="Priority order (lower = first)">
                    {rule.order}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-sm">
                      <code className="font-mono bg-muted px-2 py-0.5 rounded truncate">
                        {rule.pathPattern}
                      </code>
                      <ArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                      <span className="text-muted-foreground truncate">{rule.targetUrl}</span>
                    </div>
                    {rule.description && (
                      <p className="text-xs text-muted-foreground mt-1 truncate">
                        {rule.description}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      {rule.stripPrefix && <span>Strip prefix</span>}
                      <span>Timeout: {rule.timeout}ms</span>
                    </div>
                  </div>
                  <Switch
                    checked={rule.isEnabled}
                    onCheckedChange={() => handleToggleEnabled(rule)}
                    title={rule.isEnabled ? 'Disable rule' : 'Enable rule'}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setEditingRule(rule)}
                    title="Edit rule"
                  >
                    <Edit2 className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDeletingRule(rule)}
                    title="Delete rule"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={!!editingRule} onOpenChange={(open) => !open && setEditingRule(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Proxy Rule</DialogTitle>
            <DialogDescription>
              Update the proxy rule configuration.
            </DialogDescription>
          </DialogHeader>
          {editingRule && (
            <ProxyRuleForm
              initialData={editingRule}
              onSubmit={async (data) => {
                await onUpdateRule(editingRule.id, data);
                setEditingRule(null);
              }}
              onCancel={() => setEditingRule(null)}
            />
          )}
        </DialogContent>
      </Dialog>

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