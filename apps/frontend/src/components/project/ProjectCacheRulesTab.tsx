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
import { AlertCircle, Plus, Trash2, Edit, Clock, Shield, Globe, Lock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { Project } from '@/services/projectsApi';
import {
  useGetCacheRulesQuery,
  useCreateCacheRuleMutation,
  useUpdateCacheRuleMutation,
  useDeleteCacheRuleMutation,
  type CacheRule,
  type CreateCacheRuleDto,
} from '@/services/cacheRulesApi';

interface ProjectCacheRulesTabProps {
  project: Project;
}

// Helper to format seconds as human-readable duration
function formatDuration(seconds: number): string {
  if (seconds === 0) return 'No cache';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 31536000) return `${Math.floor(seconds / 86400)}d`;
  return `${Math.floor(seconds / 31536000)}y`;
}

// Default form state for creating a new rule
const defaultRuleForm: CreateCacheRuleDto = {
  pathPattern: '',
  browserMaxAge: 300,
  cdnMaxAge: null,
  staleWhileRevalidate: null,
  immutable: false,
  cacheability: null,
  priority: undefined,
  isEnabled: true,
  name: '',
  description: '',
};

// Preset configurations for common use cases
const presets = [
  {
    name: 'Hashed Assets (JS/CSS)',
    pathPattern: '*.{js,css}',
    browserMaxAge: 31536000,
    immutable: true,
    description: 'Content-hashed bundles that never change',
  },
  {
    name: 'Images',
    pathPattern: '*.{png,jpg,jpeg,gif,webp,svg,ico}',
    browserMaxAge: 86400,
    cdnMaxAge: 604800,
    description: 'Image assets cached for 1 day (browser) / 1 week (CDN)',
  },
  {
    name: 'Fonts',
    pathPattern: '*.{woff,woff2,ttf,otf,eot}',
    browserMaxAge: 31536000,
    immutable: true,
    description: 'Font files are typically immutable',
  },
  {
    name: 'HTML Documents',
    pathPattern: '*.html',
    browserMaxAge: 300,
    cdnMaxAge: 60,
    staleWhileRevalidate: 60,
    description: 'HTML pages with short cache + stale-while-revalidate',
  },
];

export function ProjectCacheRulesTab({ project }: ProjectCacheRulesTabProps) {
  const { toast } = useToast();
  const [showRuleDialog, setShowRuleDialog] = useState(false);
  const [editingRule, setEditingRule] = useState<CacheRule | null>(null);
  const [ruleForm, setRuleForm] = useState<CreateCacheRuleDto>(defaultRuleForm);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [ruleToDelete, setRuleToDelete] = useState<CacheRule | null>(null);

  // Queries
  const {
    data: rules,
    isLoading,
    error,
  } = useGetCacheRulesQuery(project.id);

  // Mutations
  const [createRule, { isLoading: isCreating }] = useCreateCacheRuleMutation();
  const [updateRule, { isLoading: isUpdating }] = useUpdateCacheRuleMutation();
  const [deleteRule, { isLoading: isDeleting }] = useDeleteCacheRuleMutation();

  // Open create dialog
  const handleCreateRule = () => {
    setEditingRule(null);
    setRuleForm(defaultRuleForm);
    setShowRuleDialog(true);
  };

  // Apply preset
  const applyPreset = (preset: (typeof presets)[0]) => {
    setRuleForm({
      ...defaultRuleForm,
      pathPattern: preset.pathPattern,
      browserMaxAge: preset.browserMaxAge,
      cdnMaxAge: preset.cdnMaxAge,
      staleWhileRevalidate: preset.staleWhileRevalidate,
      immutable: preset.immutable || false,
      name: preset.name,
      description: preset.description,
    });
  };

  // Open edit dialog
  const handleEditRule = (rule: CacheRule) => {
    setEditingRule(rule);
    setRuleForm({
      pathPattern: rule.pathPattern,
      browserMaxAge: rule.browserMaxAge,
      cdnMaxAge: rule.cdnMaxAge,
      staleWhileRevalidate: rule.staleWhileRevalidate,
      immutable: rule.immutable,
      cacheability: rule.cacheability,
      priority: rule.priority,
      isEnabled: rule.isEnabled,
      name: rule.name || '',
      description: rule.description || '',
    });
    setShowRuleDialog(true);
  };

  // Save rule (create or update)
  const handleSaveRule = async () => {
    try {
      if (editingRule) {
        await updateRule({
          projectId: project.id,
          ruleId: editingRule.id,
          updates: ruleForm,
        }).unwrap();
        toast({ title: 'Rule updated', description: 'Cache rule has been updated.' });
      } else {
        await createRule({
          projectId: project.id,
          rule: ruleForm,
        }).unwrap();
        toast({ title: 'Rule created', description: 'Cache rule has been created.' });
      }
      setShowRuleDialog(false);
      setEditingRule(null);
      setRuleForm(defaultRuleForm);
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err?.data?.message || 'Failed to save rule',
        variant: 'destructive',
      });
    }
  };

  // Delete rule
  const handleDeleteRule = async () => {
    if (!ruleToDelete) return;
    try {
      await deleteRule({
        projectId: project.id,
        ruleId: ruleToDelete.id,
      }).unwrap();
      toast({ title: 'Rule deleted', description: 'Cache rule has been deleted.' });
      setShowDeleteDialog(false);
      setRuleToDelete(null);
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err?.data?.message || 'Failed to delete rule',
        variant: 'destructive',
      });
    }
  };

  // Toggle rule enabled status
  const handleToggleEnabled = async (rule: CacheRule) => {
    try {
      await updateRule({
        projectId: project.id,
        ruleId: rule.id,
        updates: { isEnabled: !rule.isEnabled },
      }).unwrap();
      toast({
        title: rule.isEnabled ? 'Rule disabled' : 'Rule enabled',
        description: `Cache rule "${rule.name || rule.pathPattern}" has been ${rule.isEnabled ? 'disabled' : 'enabled'}.`,
      });
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err?.data?.message || 'Failed to toggle rule',
        variant: 'destructive',
      });
    }
  };

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Failed to load cache rules. Please try again.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Cache Rules
              </CardTitle>
              <CardDescription>
                Configure HTTP cache headers for different file patterns. Rules are evaluated in
                priority order; first match wins.
              </CardDescription>
            </div>
            <Button onClick={handleCreateRule}>
              <Plus className="h-4 w-4 mr-2" />
              Add Rule
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Info box about visibility */}
          <Alert className="mb-4">
            <Shield className="h-4 w-4" />
            <AlertDescription>
              <strong>Security:</strong> Private content automatically uses{' '}
              <code className="text-xs bg-muted px-1 rounded">Cache-Control: private</code> to prevent CDN
              caching. Public content uses{' '}
              <code className="text-xs bg-muted px-1 rounded">public</code> for optimal CDN performance.
            </AlertDescription>
          </Alert>

          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : rules && rules.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]">Priority</TableHead>
                  <TableHead>Pattern</TableHead>
                  <TableHead>Browser TTL</TableHead>
                  <TableHead>CDN TTL</TableHead>
                  <TableHead>Flags</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((rule) => (
                  <TableRow key={rule.id} className={!rule.isEnabled ? 'opacity-50' : ''}>
                    <TableCell className="font-mono text-sm">{rule.priority}</TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <code className="text-sm font-mono">{rule.pathPattern}</code>
                        {rule.name && (
                          <span className="text-xs text-muted-foreground">{rule.name}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{formatDuration(rule.browserMaxAge)}</TableCell>
                    <TableCell>
                      {rule.cdnMaxAge !== null ? formatDuration(rule.cdnMaxAge) : '-'}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {rule.immutable && (
                          <Badge variant="secondary" className="text-xs">
                            immutable
                          </Badge>
                        )}
                        {rule.staleWhileRevalidate && (
                          <Badge variant="outline" className="text-xs">
                            SWR: {formatDuration(rule.staleWhileRevalidate)}
                          </Badge>
                        )}
                        {rule.cacheability === 'public' && (
                          <Badge variant="outline" className="text-xs">
                            <Globe className="h-3 w-3 mr-1" />
                            public
                          </Badge>
                        )}
                        {rule.cacheability === 'private' && (
                          <Badge variant="outline" className="text-xs">
                            <Lock className="h-3 w-3 mr-1" />
                            private
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={rule.isEnabled}
                        onCheckedChange={() => handleToggleEnabled(rule)}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleEditRule(rule)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setRuleToDelete(rule);
                            setShowDeleteDialog(true);
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="mb-2">No cache rules configured</p>
              <p className="text-sm">
                Default caching applies: SHA URLs get 1 year immutable, alias URLs get 5 minutes.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={showRuleDialog} onOpenChange={setShowRuleDialog}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingRule ? 'Edit Cache Rule' : 'Create Cache Rule'}</DialogTitle>
            <DialogDescription>
              Configure caching behavior for files matching the pattern.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Presets (only for new rules) */}
            {!editingRule && (
              <div className="space-y-2">
                <Label>Quick Start (Presets)</Label>
                <div className="flex flex-wrap gap-2">
                  {presets.map((preset) => (
                    <Button
                      key={preset.name}
                      variant="outline"
                      size="sm"
                      onClick={() => applyPreset(preset)}
                    >
                      {preset.name}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="name">Name (optional)</Label>
              <Input
                id="name"
                value={ruleForm.name}
                onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })}
                placeholder="e.g., Hashed JavaScript bundles"
              />
            </div>

            {/* Path Pattern */}
            <div className="space-y-2">
              <Label htmlFor="pathPattern">Path Pattern *</Label>
              <Input
                id="pathPattern"
                value={ruleForm.pathPattern}
                onChange={(e) => setRuleForm({ ...ruleForm, pathPattern: e.target.value })}
                placeholder="e.g., *.js, images/**, *.{js,css}"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Matches against the deployment file path (not browser URL). If your domain maps to a
                subdirectory like <code className="bg-muted px-1 rounded">/build</code>, include it
                in the pattern.
              </p>
            </div>

            {/* Browser Max Age */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="browserMaxAge">Browser TTL (seconds)</Label>
                <Input
                  id="browserMaxAge"
                  type="number"
                  min="0"
                  max="31536000"
                  value={ruleForm.browserMaxAge}
                  onChange={(e) =>
                    setRuleForm({ ...ruleForm, browserMaxAge: parseInt(e.target.value) || 0 })
                  }
                />
                <p className="text-xs text-muted-foreground">
                  max-age: {formatDuration(ruleForm.browserMaxAge || 0)}
                </p>
              </div>

              {/* CDN Max Age */}
              <div className="space-y-2">
                <Label htmlFor="cdnMaxAge">CDN TTL (seconds)</Label>
                <Input
                  id="cdnMaxAge"
                  type="number"
                  min="0"
                  max="31536000"
                  value={ruleForm.cdnMaxAge ?? ''}
                  onChange={(e) =>
                    setRuleForm({
                      ...ruleForm,
                      cdnMaxAge: e.target.value ? parseInt(e.target.value) : undefined,
                    })
                  }
                  placeholder="Same as browser"
                />
                <p className="text-xs text-muted-foreground">
                  s-maxage:{' '}
                  {ruleForm.cdnMaxAge != null
                    ? formatDuration(ruleForm.cdnMaxAge)
                    : 'inherit'}
                </p>
              </div>
            </div>

            {/* Stale While Revalidate */}
            <div className="space-y-2">
              <Label htmlFor="staleWhileRevalidate">Stale-While-Revalidate (seconds)</Label>
              <Input
                id="staleWhileRevalidate"
                type="number"
                min="0"
                max="86400"
                value={ruleForm.staleWhileRevalidate ?? ''}
                onChange={(e) =>
                  setRuleForm({
                    ...ruleForm,
                    staleWhileRevalidate: e.target.value ? parseInt(e.target.value) : undefined,
                  })
                }
                placeholder="Not set"
              />
              <p className="text-xs text-muted-foreground">
                CDN serves stale content while fetching fresh in background.
              </p>
            </div>

            {/* Immutable */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="immutable">Immutable</Label>
                <p className="text-xs text-muted-foreground">
                  Content will never change at this URL (for content-hashed files)
                </p>
              </div>
              <Switch
                id="immutable"
                checked={ruleForm.immutable}
                onCheckedChange={(checked) => setRuleForm({ ...ruleForm, immutable: checked })}
              />
            </div>

            {/* Cacheability Override */}
            <div className="space-y-2">
              <Label htmlFor="cacheability">Cacheability Override</Label>
              <Select
                value={ruleForm.cacheability ?? 'inherit'}
                onValueChange={(value) =>
                  setRuleForm({
                    ...ruleForm,
                    cacheability: value === 'inherit' ? null : (value as 'public' | 'private'),
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">Inherit from visibility</SelectItem>
                  <SelectItem value="public">Public (CDN can cache)</SelectItem>
                  <SelectItem value="private">Private (browser only)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Usually leave as "inherit" to respect project visibility.
              </p>
            </div>

            {/* Priority */}
            <div className="space-y-2">
              <Label htmlFor="priority">Priority</Label>
              <Input
                id="priority"
                type="number"
                min="0"
                value={ruleForm.priority ?? ''}
                onChange={(e) =>
                  setRuleForm({
                    ...ruleForm,
                    priority: e.target.value ? parseInt(e.target.value) : undefined,
                  })
                }
                placeholder="Auto-assigned"
              />
              <p className="text-xs text-muted-foreground">
                Lower numbers are evaluated first. Leave empty for auto-assignment.
              </p>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Input
                id="description"
                value={ruleForm.description}
                onChange={(e) => setRuleForm({ ...ruleForm, description: e.target.value })}
                placeholder="e.g., Cache content-hashed files for 1 year"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRuleDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveRule}
              disabled={!ruleForm.pathPattern || isCreating || isUpdating}
            >
              {isCreating || isUpdating ? 'Saving...' : editingRule ? 'Update Rule' : 'Create Rule'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Cache Rule?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete the cache rule for pattern{' '}
              <code className="font-mono bg-muted px-1 rounded">
                {ruleToDelete?.pathPattern}
              </code>
              . This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteRule}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
