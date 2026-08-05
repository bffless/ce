import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import { AlertCircle, Plus, Trash2, Edit, Shield, Globe, Ban } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { Project } from '@/services/projectsApi';
import {
  useGetResponseHeaderRulesQuery,
  useCreateResponseHeaderRuleMutation,
  useUpdateResponseHeaderRuleMutation,
  useDeleteResponseHeaderRuleMutation,
  type ResponseHeaderRule,
  type CreateResponseHeaderRuleDto,
} from '@/services/responseHeaderRulesApi';

interface ProjectResponseHeaderRulesTabProps {
  project: Project;
}

const defaultRuleForm: CreateResponseHeaderRuleDto = {
  pathPattern: '',
  framePolicy: 'allow',
  allowedOrigins: [],
  priority: undefined,
  isEnabled: true,
  name: '',
  description: '',
};

export interface HeaderRulePreset {
  name: string;
  pathPattern: string;
  framePolicy: 'allow' | 'deny' | 'sameorigin';
  allowedOrigins: string[];
  description: string;
  customHeaders?: { name: string; value: string }[];
}

// eslint-disable-next-line react-refresh/only-export-components -- exported for unit testing (see __tests__/responseHeaderPresets.test.ts)
export const presets: HeaderRulePreset[] = [
  {
    name: 'Embed Widget',
    pathPattern: 'embed/**',
    framePolicy: 'allow',
    allowedOrigins: [],
    description: 'Allow iframe embedding of widget pages (add allowed origins below)',
  },
  {
    name: 'Block Framing',
    pathPattern: '**',
    framePolicy: 'deny',
    allowedOrigins: [],
    description: 'Prevent all iframe embedding',
  },
  {
    name: 'Cross-Origin Isolation',
    pathPattern: '**',
    framePolicy: 'sameorigin',
    allowedOrigins: [],
    description:
      'Enable SharedArrayBuffer for multithreaded WebAssembly (in-browser video export)',
    customHeaders: [
      { name: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
      { name: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
    ],
  },
];

function framePolicyLabel(policy: string): string {
  switch (policy) {
    case 'allow':
      return 'Allow';
    case 'deny':
      return 'Deny';
    case 'sameorigin':
    default:
      return 'Same Origin';
  }
}

function framePolicyIcon(policy: string) {
  switch (policy) {
    case 'allow':
      return <Globe className="h-3 w-3" />;
    case 'deny':
      return <Ban className="h-3 w-3" />;
    case 'sameorigin':
    default:
      return <Shield className="h-3 w-3" />;
  }
}

function framePolicyVariant(policy: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (policy) {
    case 'allow':
      return 'default';
    case 'deny':
      return 'destructive';
    default:
      return 'secondary';
  }
}

export function ProjectResponseHeaderRulesTab({ project }: ProjectResponseHeaderRulesTabProps) {
  const { toast } = useToast();
  const [showRuleDialog, setShowRuleDialog] = useState(false);
  const [editingRule, setEditingRule] = useState<ResponseHeaderRule | null>(null);
  const [ruleForm, setRuleForm] = useState<CreateResponseHeaderRuleDto>(defaultRuleForm);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [ruleToDelete, setRuleToDelete] = useState<ResponseHeaderRule | null>(null);
  const [originsText, setOriginsText] = useState('');
  const [customHeaderRows, setCustomHeaderRows] = useState<
    { name: string; value: string }[]
  >([]);

  const {
    data: rules,
    isLoading,
    error,
  } = useGetResponseHeaderRulesQuery(project.id);

  const [createRule, { isLoading: isCreating }] = useCreateResponseHeaderRuleMutation();
  const [updateRule, { isLoading: isUpdating }] = useUpdateResponseHeaderRuleMutation();
  const [deleteRule, { isLoading: isDeleting }] = useDeleteResponseHeaderRuleMutation();

  const handleCreateRule = () => {
    setEditingRule(null);
    setRuleForm(defaultRuleForm);
    setOriginsText('');
    setCustomHeaderRows([]);
    setShowRuleDialog(true);
  };

  const applyPreset = (preset: HeaderRulePreset) => {
    setRuleForm({
      ...defaultRuleForm,
      pathPattern: preset.pathPattern,
      framePolicy: preset.framePolicy,
      allowedOrigins: preset.allowedOrigins,
      name: preset.name,
      description: preset.description,
    });
    setOriginsText(preset.allowedOrigins.join('\n'));
    setCustomHeaderRows(preset.customHeaders ? [...preset.customHeaders] : []);
  };

  const handleEditRule = (rule: ResponseHeaderRule) => {
    setEditingRule(rule);
    const origins = rule.allowedOrigins || [];
    setRuleForm({
      pathPattern: rule.pathPattern,
      framePolicy: rule.framePolicy,
      allowedOrigins: origins,
      priority: rule.priority,
      isEnabled: rule.isEnabled,
      name: rule.name || '',
      description: rule.description || '',
    });
    setOriginsText(origins.join('\n'));
    setCustomHeaderRows(
      Object.entries(rule.customHeaders || {}).map(([name, value]) => ({
        name,
        value: value ?? '',
      })),
    );
    setShowRuleDialog(true);
  };

  const addCustomHeaderRow = () =>
    setCustomHeaderRows((rows) => [...rows, { name: '', value: '' }]);

  const updateCustomHeaderRow = (
    index: number,
    field: 'name' | 'value',
    next: string,
  ) =>
    setCustomHeaderRows((rows) =>
      rows.map((row, i) => (i === index ? { ...row, [field]: next } : row)),
    );

  const removeCustomHeaderRow = (index: number) =>
    setCustomHeaderRows((rows) => rows.filter((_, i) => i !== index));

  const handleSaveRule = async () => {
    // Parse origins from textarea
    const origins = originsText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    // Build custom headers from key/value rows.
    // Blank value => null, which removes a default header on matching responses.
    const customHeaders = customHeaderRows.reduce<Record<string, string | null>>(
      (acc, { name, value }) => {
        const headerName = name.trim();
        if (!headerName) return acc;
        const trimmedValue = value.trim();
        acc[headerName] = trimmedValue === '' ? null : trimmedValue;
        return acc;
      },
      {},
    );

    const formData = {
      ...ruleForm,
      allowedOrigins: origins,
      customHeaders,
    };

    try {
      if (editingRule) {
        await updateRule({
          projectId: project.id,
          ruleId: editingRule.id,
          updates: formData,
        }).unwrap();
        toast({ title: 'Rule updated', description: 'Response header rule has been updated.' });
      } else {
        await createRule({
          projectId: project.id,
          rule: formData,
        }).unwrap();
        toast({ title: 'Rule created', description: 'Response header rule has been created.' });
      }
      setShowRuleDialog(false);
      setEditingRule(null);
      setRuleForm(defaultRuleForm);
      setOriginsText('');
      setCustomHeaderRows([]);
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err?.data?.message || 'Failed to save rule',
        variant: 'destructive',
      });
    }
  };

  const handleDeleteRule = async () => {
    if (!ruleToDelete) return;
    try {
      await deleteRule({
        projectId: project.id,
        ruleId: ruleToDelete.id,
      }).unwrap();
      toast({ title: 'Rule deleted', description: 'Response header rule has been deleted.' });
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

  const handleToggleEnabled = async (rule: ResponseHeaderRule) => {
    try {
      await updateRule({
        projectId: project.id,
        ruleId: rule.id,
        updates: { isEnabled: !rule.isEnabled },
      }).unwrap();
      toast({
        title: rule.isEnabled ? 'Rule disabled' : 'Rule enabled',
        description: `Rule "${rule.name || rule.pathPattern}" has been ${rule.isEnabled ? 'disabled' : 'enabled'}.`,
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
          Failed to load response header rules. Please try again.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Response Header Rules
              </CardTitle>
              <CardDescription>
                Control iframe embedding and custom response headers for specific paths.
                Rules are evaluated in priority order; first match wins.
              </CardDescription>
            </div>
            <Button onClick={handleCreateRule}>
              <Plus className="h-4 w-4 mr-2" />
              Add Rule
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Alert className="mb-4">
            <Shield className="h-4 w-4" />
            <AlertDescription>
              By default, all content uses <code className="text-xs bg-muted px-1 rounded">X-Frame-Options: SAMEORIGIN</code> which
              prevents embedding on other sites. Use these rules to allow specific paths to be
              embedded in iframes on external domains.
            </AlertDescription>
          </Alert>

          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : rules && rules.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]">Priority</TableHead>
                  <TableHead>Pattern</TableHead>
                  <TableHead>Frame Policy</TableHead>
                  <TableHead>Allowed Origins</TableHead>
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
                        {rule.customHeaders &&
                          Object.keys(rule.customHeaders).length > 0 && (
                            <span className="text-xs text-muted-foreground">
                              {Object.keys(rule.customHeaders).length} custom header
                              {Object.keys(rule.customHeaders).length === 1 ? '' : 's'}
                            </span>
                          )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={framePolicyVariant(rule.framePolicy)} className="gap-1">
                        {framePolicyIcon(rule.framePolicy)}
                        {framePolicyLabel(rule.framePolicy)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {rule.framePolicy === 'allow' && rule.allowedOrigins?.length ? (
                        <div className="flex flex-col gap-0.5">
                          {(rule.allowedOrigins as string[]).slice(0, 2).map((origin) => (
                            <code key={origin} className="text-xs font-mono text-muted-foreground">
                              {origin}
                            </code>
                          ))}
                          {(rule.allowedOrigins as string[]).length > 2 && (
                            <span className="text-xs text-muted-foreground">
                              +{(rule.allowedOrigins as string[]).length - 2} more
                            </span>
                          )}
                        </div>
                      ) : rule.framePolicy === 'allow' ? (
                        <span className="text-xs text-muted-foreground">All origins</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={rule.isEnabled}
                        onCheckedChange={() => handleToggleEnabled(rule)}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => handleEditRule(rule)}>
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
              <Shield className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="mb-2">No response header rules configured</p>
              <p className="text-sm">
                Default security headers apply. Add a rule to allow iframe embedding on specific paths.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={showRuleDialog} onOpenChange={setShowRuleDialog}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingRule ? 'Edit Response Header Rule' : 'Create Response Header Rule'}
            </DialogTitle>
            <DialogDescription>
              Configure response headers for files matching the pattern.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Presets */}
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
              <Label htmlFor="rhr-name">Name (optional)</Label>
              <Input
                id="rhr-name"
                value={ruleForm.name}
                onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })}
                placeholder="e.g., Allow chat widget embedding"
              />
            </div>

            {/* Path Pattern */}
            <div className="space-y-2">
              <Label htmlFor="rhr-pathPattern">Path Pattern *</Label>
              <Input
                id="rhr-pathPattern"
                value={ruleForm.pathPattern}
                onChange={(e) => setRuleForm({ ...ruleForm, pathPattern: e.target.value })}
                placeholder="e.g., embed/**, widget/*"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Glob pattern matching against the deployment file path.
              </p>
            </div>

            {/* Frame Policy */}
            <div className="space-y-2">
              <Label htmlFor="rhr-framePolicy">Frame Embedding Policy</Label>
              <Select
                value={ruleForm.framePolicy || 'sameorigin'}
                onValueChange={(value) =>
                  setRuleForm({
                    ...ruleForm,
                    framePolicy: value as 'sameorigin' | 'allow' | 'deny',
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sameorigin">Same Origin (default)</SelectItem>
                  <SelectItem value="allow">Allow from specific origins</SelectItem>
                  <SelectItem value="deny">Deny all framing</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Allowed Origins (only when framePolicy is 'allow') */}
            {ruleForm.framePolicy === 'allow' && (
              <div className="space-y-2">
                <Label htmlFor="rhr-allowedOrigins">Allowed Origins</Label>
                <Textarea
                  id="rhr-allowedOrigins"
                  value={originsText}
                  onChange={(e) => setOriginsText(e.target.value)}
                  placeholder="https://www.example.com&#10;https://example.com"
                  rows={3}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  One origin per line. Include the full URL with protocol (e.g., https://example.com).
                  Leave empty to allow all origins.
                </p>
              </div>
            )}

            {/* Custom Headers */}
            <div className="space-y-2">
              <Label>Custom Headers (optional)</Label>
              <div className="space-y-2">
                {customHeaderRows.map((row, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      value={row.name}
                      onChange={(e) =>
                        updateCustomHeaderRow(index, 'name', e.target.value)
                      }
                      placeholder="Header-Name"
                      className="font-mono text-sm"
                    />
                    <Input
                      value={row.value}
                      onChange={(e) =>
                        updateCustomHeaderRow(index, 'value', e.target.value)
                      }
                      placeholder="value"
                      className="font-mono text-sm"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeCustomHeaderRow(index)}
                      aria-label="Remove header"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button variant="outline" size="sm" onClick={addCustomHeaderRow}>
                <Plus className="h-4 w-4 mr-2" />
                Add header
              </Button>
              <p className="text-xs text-muted-foreground">
                Arbitrary response headers applied to matching files (e.g.{' '}
                <code className="text-xs bg-muted px-1 rounded">
                  Cross-Origin-Opener-Policy
                </code>
                ). Leave the value blank to remove a default header.
              </p>
            </div>

            {/* Priority */}
            <div className="space-y-2">
              <Label htmlFor="rhr-priority">Priority</Label>
              <Input
                id="rhr-priority"
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
              <Label htmlFor="rhr-description">Description (optional)</Label>
              <Input
                id="rhr-description"
                value={ruleForm.description}
                onChange={(e) => setRuleForm({ ...ruleForm, description: e.target.value })}
                placeholder="e.g., Allow Wix site to embed chat widget"
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
              {isCreating || isUpdating
                ? 'Saving...'
                : editingRule
                  ? 'Update Rule'
                  : 'Create Rule'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Response Header Rule?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete the rule for pattern{' '}
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
