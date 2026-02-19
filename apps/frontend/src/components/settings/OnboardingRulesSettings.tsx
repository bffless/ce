import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  useGetOnboardingRulesQuery,
  useCreateOnboardingRuleMutation,
  useUpdateOnboardingRuleMutation,
  useDeleteOnboardingRuleMutation,
  useGetRecentExecutionsQuery,
  OnboardingRule,
  OnboardingAction,
  OnboardingTrigger,
} from '@/services/onboardingRulesApi';
import { useListUserProjectsQuery, Project } from '@/services/projectsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from '@/components/ui/form';
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
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  CheckCircle,
  XCircle,
  Loader2,
  UserPlus,
  Plus,
  Trash2,
  Edit,
  Clock,
  AlertTriangle,
  GitBranch,
  History,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const ruleSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(500).optional(),
  trigger: z.enum(['user_signup', 'invite_accepted']),
  repository: z.string().min(1, 'Repository is required'),
  role: z.enum(['viewer', 'contributor', 'admin']),
  priority: z.coerce.number().min(0).default(100),
});

type RuleFormValues = z.infer<typeof ruleSchema>;

export function OnboardingRulesSettings() {
  const { toast } = useToast();
  const { data: rulesData, isLoading: rulesLoading, error: rulesError } = useGetOnboardingRulesQuery();
  const { data: projects } = useListUserProjectsQuery();
  const { data: executionsData } = useGetRecentExecutionsQuery(20);
  const [createRule, { isLoading: isCreating }] = useCreateOnboardingRuleMutation();
  const [updateRule] = useUpdateOnboardingRuleMutation();
  const [deleteRule, { isLoading: isDeleting }] = useDeleteOnboardingRuleMutation();

  const [showRuleForm, setShowRuleForm] = useState(false);
  const [editingRule, setEditingRule] = useState<OnboardingRule | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [ruleToDelete, setRuleToDelete] = useState<OnboardingRule | null>(null);

  const form = useForm<RuleFormValues>({
    resolver: zodResolver(ruleSchema),
    defaultValues: {
      name: '',
      description: '',
      trigger: 'user_signup',
      repository: '',
      role: 'viewer',
      priority: 100,
    },
  });

  const openCreateForm = () => {
    form.reset({
      name: '',
      description: '',
      trigger: 'user_signup',
      repository: '',
      role: 'viewer',
      priority: 100,
    });
    setEditingRule(null);
    setShowRuleForm(true);
  };

  const openEditForm = (rule: OnboardingRule) => {
    // Extract repository and role from first action
    const firstAction = rule.actions[0];
    const repository = firstAction?.type === 'grant_repo_access'
      ? (firstAction.params as { repository: string }).repository
      : '';
    const role = firstAction?.type === 'grant_repo_access'
      ? (firstAction.params as { role: string }).role as 'viewer' | 'contributor' | 'admin'
      : 'viewer';

    form.reset({
      name: rule.name,
      description: rule.description || '',
      trigger: rule.trigger,
      repository,
      role,
      priority: rule.priority,
    });
    setEditingRule(rule);
    setShowRuleForm(true);
  };

  const onSubmit = async (data: RuleFormValues) => {
    const actions: OnboardingAction[] = [
      {
        type: 'grant_repo_access',
        params: {
          repository: data.repository,
          role: data.role,
        },
      },
    ];

    try {
      if (editingRule) {
        await updateRule({
          id: editingRule.id,
          data: {
            name: data.name,
            description: data.description || undefined,
            trigger: data.trigger,
            actions,
            priority: data.priority,
          },
        }).unwrap();
        toast({
          title: 'Rule updated',
          description: `Onboarding rule "${data.name}" has been updated`,
        });
      } else {
        await createRule({
          name: data.name,
          description: data.description || undefined,
          trigger: data.trigger,
          actions,
          priority: data.priority,
        }).unwrap();
        toast({
          title: 'Rule created',
          description: `Onboarding rule "${data.name}" has been created`,
        });
      }
      form.reset();
      setShowRuleForm(false);
      setEditingRule(null);
    } catch (err: any) {
      toast({
        title: editingRule ? 'Failed to update rule' : 'Failed to create rule',
        description: err?.data?.message || 'An error occurred',
        variant: 'destructive',
      });
    }
  };

  const handleToggleEnabled = async (rule: OnboardingRule) => {
    try {
      await updateRule({
        id: rule.id,
        data: { enabled: !rule.enabled },
      }).unwrap();
      toast({
        title: rule.enabled ? 'Rule disabled' : 'Rule enabled',
        description: `"${rule.name}" has been ${rule.enabled ? 'disabled' : 'enabled'}`,
      });
    } catch (err: any) {
      toast({
        title: 'Failed to update rule',
        description: err?.data?.message || 'An error occurred',
        variant: 'destructive',
      });
    }
  };

  const handleDeleteClick = (rule: OnboardingRule) => {
    setRuleToDelete(rule);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!ruleToDelete) return;

    try {
      await deleteRule(ruleToDelete.id).unwrap();
      toast({
        title: 'Rule deleted',
        description: `"${ruleToDelete.name}" has been deleted`,
      });
    } catch (err: any) {
      toast({
        title: 'Failed to delete rule',
        description: err?.data?.message || 'An error occurred',
        variant: 'destructive',
      });
    } finally {
      setDeleteDialogOpen(false);
      setRuleToDelete(null);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getTriggerBadge = (trigger: OnboardingTrigger) => {
    if (trigger === 'user_signup') {
      return <Badge variant="default">User Signup</Badge>;
    }
    return <Badge variant="secondary">Invite Accepted</Badge>;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'success':
        return (
          <Badge variant="default" className="bg-green-500">
            <CheckCircle className="h-3 w-3 mr-1" />
            Success
          </Badge>
        );
      case 'partial':
        return (
          <Badge variant="default" className="bg-yellow-500">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Partial
          </Badge>
        );
      case 'failed':
        return (
          <Badge variant="destructive">
            <XCircle className="h-3 w-3 mr-1" />
            Failed
          </Badge>
        );
      case 'skipped':
        return (
          <Badge variant="secondary">
            <Clock className="h-3 w-3 mr-1" />
            Skipped
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getActionDescription = (action: OnboardingAction) => {
    if (action.type === 'grant_repo_access') {
      const params = action.params as { repository: string; role: string };
      return `Grant ${params.role} access to ${params.repository}`;
    }
    if (action.type === 'assign_role') {
      const params = action.params as { role: string };
      return `Assign workspace role: ${params.role}`;
    }
    if (action.type === 'add_to_group') {
      const params = action.params as { groupId: string };
      return `Add to group: ${params.groupId}`;
    }
    return action.type;
  };

  const rules = rulesData?.rules || [];
  const executions = executionsData?.executions || [];
  const enabledCount = rules.filter((r) => r.enabled).length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            <div>
              <CardTitle>User Onboarding Rules</CardTitle>
              <CardDescription>
                Configure automatic actions when users sign up
              </CardDescription>
            </div>
          </div>
          <Button onClick={openCreateForm}>
            <Plus className="h-4 w-4 mr-2" />
            Add Rule
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stats */}
        <div className="flex gap-4 text-sm text-muted-foreground">
          <span>{enabledCount} enabled</span>
          <span>{rules.length} total rules</span>
        </div>

        {/* Error State */}
        {rulesError && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertDescription>
              Failed to load onboarding rules. Please try again.
            </AlertDescription>
          </Alert>
        )}

        {/* Loading State */}
        {rulesLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Rules Table */}
        {!rulesLoading && !rulesError && rules.length > 0 && (
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Actions</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead className="text-center">Enabled</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{rule.name}</p>
                        {rule.description && (
                          <p className="text-sm text-muted-foreground truncate max-w-xs">
                            {rule.description}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{getTriggerBadge(rule.trigger)}</TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        {rule.actions.map((action, idx) => (
                          <div key={idx} className="flex items-center gap-1 text-sm">
                            <GitBranch className="h-3 w-3" />
                            <span>{getActionDescription(action)}</span>
                          </div>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{rule.priority}</TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={rule.enabled}
                        onCheckedChange={() => handleToggleEnabled(rule)}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditForm(rule)}
                          title="Edit rule"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteClick(rule)}
                          disabled={isDeleting}
                          title="Delete rule"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Empty State */}
        {!rulesLoading && !rulesError && rules.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <UserPlus className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No onboarding rules configured</p>
            <p className="text-sm">
              Click "Add Rule" to automatically grant repository access to new users
            </p>
          </div>
        )}

        {/* Recent Executions Accordion */}
        {executions.length > 0 && (
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="executions">
              <AccordionTrigger>
                <div className="flex items-center gap-2">
                  <History className="h-4 w-4" />
                  Recent Executions ({executions.length})
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="border rounded-lg">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Rule</TableHead>
                        <TableHead>Trigger</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Executed</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {executions.map((execution) => (
                        <TableRow key={execution.id}>
                          <TableCell className="font-medium">
                            {execution.ruleName}
                          </TableCell>
                          <TableCell>{getTriggerBadge(execution.trigger)}</TableCell>
                          <TableCell>
                            <div>
                              {getStatusBadge(execution.status)}
                              {execution.errorMessage && (
                                <p className="text-xs text-destructive mt-1">
                                  {execution.errorMessage}
                                </p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {formatDate(execution.executedAt)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        )}

        {/* Rule Form Dialog */}
        <Dialog open={showRuleForm} onOpenChange={setShowRuleForm}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>
                {editingRule ? 'Edit Onboarding Rule' : 'Create Onboarding Rule'}
              </DialogTitle>
              <DialogDescription>
                Configure automatic actions for new user signups.
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Rule Name</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., Grant demo repo access" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description (Optional)</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Describe what this rule does..."
                          className="resize-none"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="trigger"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Trigger</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select trigger" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="user_signup">User Signup</SelectItem>
                          <SelectItem value="invite_accepted">Invite Accepted</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        When should this rule be executed?
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="repository"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Repository</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select repository" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {projects?.map((project: Project) => (
                            <SelectItem
                              key={project.id}
                              value={`${project.owner}/${project.name}`}
                            >
                              {project.owner}/{project.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        Grant access to this repository
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="role"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Role</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select role" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="viewer">Viewer (read-only)</SelectItem>
                          <SelectItem value="contributor">Contributor (read/write)</SelectItem>
                          <SelectItem value="admin">Admin (full access)</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        Permission level to grant
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="priority"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Priority</FormLabel>
                      <FormControl>
                        <Input type="number" min={0} {...field} />
                      </FormControl>
                      <FormDescription>
                        Lower numbers execute first (default: 100)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowRuleForm(false);
                      setEditingRule(null);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isCreating}>
                    {isCreating ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : editingRule ? (
                      'Update Rule'
                    ) : (
                      'Create Rule'
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Onboarding Rule</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete "{ruleToDelete?.name}"? This action
                cannot be undone. New users will no longer receive automatic access.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteConfirm}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
