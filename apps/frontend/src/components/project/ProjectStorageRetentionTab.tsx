import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertCircle,
  Plus,
  Trash2,
  Edit,
  Play,
  Eye,
  HardDrive,
  GitBranch,
  Clock,
  FileX2,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { Project } from '@/services/projectsApi';
import {
  useGetStorageOverviewQuery,
  useGetRetentionRulesQuery,
  useCreateRetentionRuleMutation,
  useUpdateRetentionRuleMutation,
  useDeleteRetentionRuleMutation,
  useLazyPreviewRetentionRuleQuery,
  useExecuteRetentionRuleMutation,
  useGetRetentionLogsQuery,
  type RetentionRule,
  type CreateRetentionRuleDto,
  type PathMode,
  type PreviewCommit,
} from '@/services/retentionApi';

interface ProjectStorageRetentionTabProps {
  project: Project;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 30) return `${diffDays} days ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

const defaultRuleForm: CreateRetentionRuleDto = {
  name: '',
  branchPattern: '**',
  excludeBranches: ['main', 'master'],
  retentionDays: 30,
  keepWithAlias: true,
  keepMinimum: 1,
  enabled: true,
  pathPatterns: [],
  pathMode: undefined,
};

export function ProjectStorageRetentionTab({ project }: ProjectStorageRetentionTabProps) {
  const { toast } = useToast();
  const [showRuleDialog, setShowRuleDialog] = useState(false);
  const [editingRule, setEditingRule] = useState<RetentionRule | null>(null);
  const [ruleForm, setRuleForm] = useState<CreateRetentionRuleDto>(defaultRuleForm);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [ruleToDelete, setRuleToDelete] = useState<RetentionRule | null>(null);
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  const [previewData, setPreviewData] = useState<{
    commits: PreviewCommit[];
    totalAssets: number;
    totalBytes: number;
  } | null>(null);
  const [previewingRuleId, setPreviewingRuleId] = useState<string | null>(null);
  const [excludeBranchesInput, setExcludeBranchesInput] = useState('');
  const [pathPatternsInput, setPathPatternsInput] = useState('');

  // Queries
  const {
    data: storageOverview,
    isLoading: isLoadingOverview,
    error: overviewError,
  } = useGetStorageOverviewQuery(project.id);

  const {
    data: rules,
    isLoading: isLoadingRules,
    error: rulesError,
    refetch: refetchRules,
  } = useGetRetentionRulesQuery(project.id);

  const {
    data: logsData,
    refetch: refetchLogs,
    isFetching: isRefetchingLogs,
  } = useGetRetentionLogsQuery({ projectId: project.id, limit: 10 });

  // Mutations
  const [createRule, { isLoading: isCreating }] = useCreateRetentionRuleMutation();
  const [updateRule, { isLoading: isUpdating }] = useUpdateRetentionRuleMutation();
  const [deleteRule, { isLoading: isDeleting }] = useDeleteRetentionRuleMutation();
  const [triggerPreview] = useLazyPreviewRetentionRuleQuery();
  const [executeRule, { isLoading: isExecuting }] = useExecuteRetentionRuleMutation();

  const isLoading = isLoadingOverview || isLoadingRules;
  const error = overviewError || rulesError;

  // Open create dialog
  const handleCreateRule = () => {
    setEditingRule(null);
    setRuleForm(defaultRuleForm);
    setExcludeBranchesInput('main, master');
    setPathPatternsInput('');
    setShowRuleDialog(true);
  };

  // Open edit dialog
  const handleEditRule = (rule: RetentionRule) => {
    setEditingRule(rule);
    setRuleForm({
      name: rule.name,
      branchPattern: rule.branchPattern,
      excludeBranches: rule.excludeBranches,
      retentionDays: rule.retentionDays,
      keepWithAlias: rule.keepWithAlias,
      keepMinimum: rule.keepMinimum,
      enabled: rule.enabled,
      pathPatterns: rule.pathPatterns,
      pathMode: rule.pathMode,
    });
    setExcludeBranchesInput(rule.excludeBranches.join(', '));
    setPathPatternsInput(rule.pathPatterns?.join(', ') || '');
    setShowRuleDialog(true);
  };

  // Save rule (create or update)
  const handleSaveRule = async () => {
    // Parse comma-separated values
    const excludeBranches = excludeBranchesInput
      .split(',')
      .map((b) => b.trim())
      .filter(Boolean);
    const pathPatterns = pathPatternsInput
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);

    const ruleData: CreateRetentionRuleDto = {
      ...ruleForm,
      excludeBranches,
      pathPatterns: pathPatterns.length > 0 ? pathPatterns : undefined,
      // Default to 'exclude' if path patterns are provided but no mode selected
      pathMode: pathPatterns.length > 0 ? ruleForm.pathMode || 'exclude' : undefined,
    };

    try {
      if (editingRule) {
        await updateRule({
          projectId: project.id,
          ruleId: editingRule.id,
          updates: ruleData,
        }).unwrap();
        toast({ title: 'Rule updated', description: 'Retention rule has been updated.' });
      } else {
        await createRule({
          projectId: project.id,
          rule: ruleData,
        }).unwrap();
        toast({ title: 'Rule created', description: 'Retention rule has been created.' });
      }
      setShowRuleDialog(false);
    } catch (err: unknown) {
      const errorMessage =
        (err as { data?: { message?: string } })?.data?.message || 'Failed to save rule';
      toast({ title: 'Error', description: errorMessage, variant: 'destructive' });
    }
  };

  // Delete rule
  const handleConfirmDelete = async () => {
    if (!ruleToDelete) return;
    try {
      await deleteRule({ projectId: project.id, ruleId: ruleToDelete.id }).unwrap();
      toast({ title: 'Rule deleted', description: 'Retention rule has been deleted.' });
      setShowDeleteDialog(false);
      setRuleToDelete(null);
    } catch (err: unknown) {
      const errorMessage =
        (err as { data?: { message?: string } })?.data?.message || 'Failed to delete rule';
      toast({ title: 'Error', description: errorMessage, variant: 'destructive' });
    }
  };

  // Preview rule
  const handlePreview = async (rule: RetentionRule) => {
    setPreviewingRuleId(rule.id);
    try {
      const result = await triggerPreview({ projectId: project.id, ruleId: rule.id }).unwrap();
      setPreviewData(result);
      setShowPreviewDialog(true);
    } catch (err: unknown) {
      const errorMessage =
        (err as { data?: { message?: string } })?.data?.message || 'Failed to preview';
      toast({ title: 'Error', description: errorMessage, variant: 'destructive' });
    } finally {
      setPreviewingRuleId(null);
    }
  };

  // Check if any rule is currently executing
  const executingRule = rules?.find((r) => r.executionStartedAt);

  // Execute rule
  const handleExecute = async (rule: RetentionRule) => {
    if (
      !confirm(
        `Are you sure you want to execute "${rule.name}"? This will permanently delete matching commits/files.`,
      )
    ) {
      return;
    }
    try {
      const result = await executeRule({ projectId: project.id, ruleId: rule.id }).unwrap();
      if (result.started) {
        toast({
          title: 'Deletion started',
          description: 'Check Recent Deletions below for progress. This may take a few minutes.',
        });
      } else {
        toast({
          title: 'Already running',
          description: result.message,
          variant: 'destructive',
        });
      }
    } catch (err: unknown) {
      const errorMessage =
        (err as { data?: { message?: string } })?.data?.message || 'Failed to execute rule';
      toast({ title: 'Error', description: errorMessage, variant: 'destructive' });
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-60" />
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-40" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-40" />
          </CardContent>
        </Card>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Storage & Retention</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Failed to load storage data.{' '}
              {(error as { data?: { message?: string } })?.data?.message || 'Unknown error'}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Storage Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HardDrive className="h-5 w-5" />
            Storage Overview
          </CardTitle>
          <CardDescription>Current storage usage for this project</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="p-4 rounded-lg border bg-muted/30">
              <div className="text-2xl font-bold">
                {formatBytes(storageOverview?.totalBytes || 0)}
              </div>
              <div className="text-sm text-muted-foreground">Total Storage</div>
            </div>
            <div className="p-4 rounded-lg border bg-muted/30">
              <div className="text-2xl font-bold">{storageOverview?.commitCount || 0}</div>
              <div className="text-sm text-muted-foreground">Commits</div>
            </div>
            <div className="p-4 rounded-lg border bg-muted/30">
              <div className="text-2xl font-bold">{storageOverview?.branchCount || 0}</div>
              <div className="text-sm text-muted-foreground">Branches</div>
            </div>
            <div className="p-4 rounded-lg border bg-muted/30">
              <div className="text-2xl font-bold">
                {storageOverview?.oldestCommitAt
                  ? formatRelativeTime(storageOverview.oldestCommitAt)
                  : 'N/A'}
              </div>
              <div className="text-sm text-muted-foreground">Oldest Commit</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Retention Rules */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Retention Rules
              </CardTitle>
              <CardDescription>Configure automatic cleanup of old commits</CardDescription>
            </div>
            <Button onClick={handleCreateRule}>
              <Plus className="h-4 w-4 mr-2" />
              Add Rule
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {rules && rules.length === 0 ? (
            <div className="text-center py-12">
              <FileX2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No retention rules</h3>
              <p className="text-muted-foreground mb-4">
                Create a rule to automatically clean up old commits and save storage space.
              </p>
              <Button onClick={handleCreateRule}>
                <Plus className="h-4 w-4 mr-2" />
                Create First Rule
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Branch Pattern</TableHead>
                  <TableHead>Retention</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules?.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell className="font-medium">{rule.name}</TableCell>
                    <TableCell>
                      <code className="text-xs bg-muted px-1 py-0.5 rounded">
                        {rule.branchPattern}
                      </code>
                      {rule.excludeBranches.length > 0 && (
                        <span className="text-xs text-muted-foreground ml-2">
                          (excludes: {rule.excludeBranches.slice(0, 2).join(', ')}
                          {rule.excludeBranches.length > 2 && '...'})
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{rule.retentionDays} days</TableCell>
                    <TableCell>
                      {rule.pathMode ? (
                        <Badge variant="outline" className="text-xs">
                          {rule.pathMode === 'exclude' ? 'Delete paths' : 'Keep paths'}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">Full commit</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={rule.enabled ? 'default' : 'secondary'}>
                        {rule.enabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handlePreview(rule)}
                          disabled={previewingRuleId === rule.id}
                        >
                          {previewingRuleId === rule.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleExecute(rule)}
                          disabled={isExecuting || !!rule.executionStartedAt || !!executingRule}
                          title={
                            rule.executionStartedAt
                              ? 'Execution in progress'
                              : executingRule
                                ? `Another rule is executing: ${executingRule.name}`
                                : 'Execute rule'
                          }
                        >
                          {rule.executionStartedAt ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Play className="h-4 w-4" />
                          )}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleEditRule(rule)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setRuleToDelete(rule);
                            setShowDeleteDialog(true);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Execution Banner */}
      {executingRule && (
        <Alert className="border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950">
          <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
          <AlertDescription className="flex items-center justify-between">
            <span>
              Executing rule "<strong>{executingRule.name}</strong>" - deletions in progress...
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                refetchRules();
                refetchLogs();
              }}
            >
              <RefreshCw className="h-4 w-4 mr-1" />
              Refresh
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Recent Deletions */}
      {(logsData && logsData.data.length > 0) || executingRule ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <GitBranch className="h-5 w-5" />
                  Recent Deletions
                </CardTitle>
                <CardDescription>History of automatic and manual deletions</CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  refetchLogs();
                  refetchRules();
                }}
                disabled={isRefetchingLogs}
              >
                {isRefetchingLogs ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                <span className="ml-1">Refresh</span>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Commit</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Assets</TableHead>
                  <TableHead>Freed</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logsData?.data.length === 0 && executingRule && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-4">
                      Waiting for deletions to complete...
                    </TableCell>
                  </TableRow>
                )}
                {logsData?.data.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell>
                      <code className="text-xs">{log.commitSha.substring(0, 8)}</code>
                    </TableCell>
                    <TableCell>{log.branch || '-'}</TableCell>
                    <TableCell>{log.assetCount}</TableCell>
                    <TableCell>{formatBytes(log.freedBytes)}</TableCell>
                    <TableCell>
                      <Badge variant={log.isPartial ? 'outline' : 'secondary'}>
                        {log.isPartial ? 'Partial' : 'Full'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatRelativeTime(log.deletedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {/* Create/Edit Rule Dialog */}
      <Dialog open={showRuleDialog} onOpenChange={setShowRuleDialog}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingRule ? 'Edit Retention Rule' : 'Create Retention Rule'}
            </DialogTitle>
            <DialogDescription>
              Configure when and what to delete from old commits.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Rule Name</Label>
              <Input
                id="name"
                placeholder="e.g., Clean up feature branches"
                value={ruleForm.name}
                onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="branchPattern">Branch Pattern (glob)</Label>
              <Input
                id="branchPattern"
                placeholder="e.g., **, feature/**, release/*"
                value={ruleForm.branchPattern}
                onChange={(e) => setRuleForm({ ...ruleForm, branchPattern: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Use ** to match all branches, * matches within a segment. Examples: ** (all),
                feature/** (feature branches), release/* (release/v1 but not release/v1/hotfix)
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="excludeBranches">Exclude Branches (comma-separated)</Label>
              <Input
                id="excludeBranches"
                placeholder="main, master, develop"
                value={excludeBranchesInput}
                onChange={(e) => setExcludeBranchesInput(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="retentionDays">Retention Days</Label>
              <Input
                id="retentionDays"
                type="number"
                min={1}
                max={3650}
                value={ruleForm.retentionDays}
                onChange={(e) =>
                  setRuleForm({ ...ruleForm, retentionDays: parseInt(e.target.value) || 30 })
                }
              />
              <p className="text-xs text-muted-foreground">
                Delete commits older than this many days
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="keepMinimum">Keep Minimum Commits</Label>
              <Input
                id="keepMinimum"
                type="number"
                min={0}
                max={100}
                value={ruleForm.keepMinimum}
                onChange={(e) =>
                  setRuleForm({ ...ruleForm, keepMinimum: parseInt(e.target.value) || 0 })
                }
              />
              <p className="text-xs text-muted-foreground">
                Always keep at least N most recent commits per branch
              </p>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="keepWithAlias">Protect Aliased Commits</Label>
                <p className="text-xs text-muted-foreground">
                  Never delete commits with active aliases (production, staging, etc.)
                </p>
              </div>
              <Switch
                id="keepWithAlias"
                checked={ruleForm.keepWithAlias}
                onCheckedChange={(checked) => setRuleForm({ ...ruleForm, keepWithAlias: checked })}
              />
            </div>

            <div className="border-t pt-4">
              <h4 className="font-medium mb-2">Partial Deletion (Optional)</h4>
              <p className="text-xs text-muted-foreground mb-3">
                Delete specific file paths instead of entire commits
              </p>

              <div className="space-y-2">
                <Label htmlFor="pathPatterns">Path Patterns (comma-separated)</Label>
                <Input
                  id="pathPatterns"
                  placeholder="coverage/**, *.map, test-results/**"
                  value={pathPatternsInput}
                  onChange={(e) => setPathPatternsInput(e.target.value)}
                />
              </div>

              {pathPatternsInput.trim() && (
                <div className="space-y-2 mt-2">
                  <Label htmlFor="pathMode">Path Mode</Label>
                  <Select
                    value={ruleForm.pathMode || 'exclude'}
                    onValueChange={(value: PathMode) =>
                      setRuleForm({ ...ruleForm, pathMode: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="exclude">
                        Delete matching paths (keep everything else)
                      </SelectItem>
                      <SelectItem value="include">
                        Keep matching paths (delete everything else)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="enabled">Enable Rule</Label>
                <p className="text-xs text-muted-foreground">
                  Disabled rules won't run automatically
                </p>
              </div>
              <Switch
                id="enabled"
                checked={ruleForm.enabled}
                onCheckedChange={(checked) => setRuleForm({ ...ruleForm, enabled: checked })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRuleDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveRule} disabled={isCreating || isUpdating || !ruleForm.name}>
              {isCreating || isUpdating ? 'Saving...' : editingRule ? 'Update Rule' : 'Create Rule'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Retention Rule</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{ruleToDelete?.name}"? This action cannot be undone.
              Historical deletion logs will be preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} disabled={isDeleting}>
              {isDeleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Preview Dialog */}
      <Dialog open={showPreviewDialog} onOpenChange={setShowPreviewDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Preview: Commits to Delete</DialogTitle>
            <DialogDescription>
              {previewData?.commits.length === 0
                ? 'No commits match the rule criteria.'
                : `${previewData?.commits.length} commit(s) would be affected, freeing ${formatBytes(previewData?.totalBytes || 0)}`}
            </DialogDescription>
          </DialogHeader>
          {previewData && previewData.commits.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Commit</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Age</TableHead>
                  <TableHead>Assets</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {previewData.commits.map((commit) => (
                  <TableRow key={commit.sha}>
                    <TableCell>
                      <code className="text-xs">{commit.sha.substring(0, 8)}</code>
                    </TableCell>
                    <TableCell>{commit.branch}</TableCell>
                    <TableCell>{commit.ageDays} days</TableCell>
                    <TableCell>
                      {commit.isPartial
                        ? `${commit.assetCount}/${commit.totalAssetCount}`
                        : commit.assetCount}
                    </TableCell>
                    <TableCell>
                      {commit.isPartial
                        ? `${formatBytes(commit.sizeBytes)} / ${formatBytes(commit.totalSizeBytes || 0)}`
                        : formatBytes(commit.sizeBytes)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={commit.isPartial ? 'outline' : 'secondary'}>
                        {commit.isPartial ? 'Partial' : 'Full'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPreviewDialog(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
