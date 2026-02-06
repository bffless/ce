import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ProxyRulesEditor } from './ProxyRulesEditor';
import {
  useGetRuleSetQuery,
  useCreateRuleInSetMutation,
  useUpdateProxyRuleMutation,
  useDeleteProxyRuleMutation,
  useReorderRulesInSetMutation,
  type CreateProxyRuleDto,
  type UpdateProxyRuleDto,
} from '@/services/proxyRulesApi';
import { useToast } from '@/hooks/use-toast';

interface RuleSetEditorDialogProps {
  ruleSetId: string;
  ruleSetName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RuleSetEditorDialog({
  ruleSetId,
  ruleSetName,
  open,
  onOpenChange,
}: RuleSetEditorDialogProps) {
  const { toast } = useToast();

  // Fetch the rule set with its rules
  const { data, isLoading, error } = useGetRuleSetQuery(ruleSetId, {
    skip: !open || !ruleSetId,
  });

  // Mutations
  const [createRule] = useCreateRuleInSetMutation();
  const [updateRule] = useUpdateProxyRuleMutation();
  const [deleteRule] = useDeleteProxyRuleMutation();
  const [reorderRules] = useReorderRulesInSetMutation();

  const handleCreateRule = async (rule: CreateProxyRuleDto) => {
    try {
      await createRule({ ruleSetId, rule }).unwrap();
      toast({
        title: 'Rule created',
        description: `Proxy rule for "${rule.pathPattern}" has been created.`,
      });
    } catch (err: unknown) {
      const errorMessage =
        (err as { data?: { message?: string } })?.data?.message || 'Failed to create proxy rule';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
      throw err;
    }
  };

  const handleUpdateRule = async (id: string, updates: UpdateProxyRuleDto) => {
    try {
      await updateRule({ id, updates }).unwrap();
      toast({
        title: 'Rule updated',
        description: 'Proxy rule has been updated.',
      });
    } catch (err: unknown) {
      const errorMessage =
        (err as { data?: { message?: string } })?.data?.message || 'Failed to update proxy rule';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
      throw err;
    }
  };

  const handleDeleteRule = async (id: string) => {
    try {
      await deleteRule(id).unwrap();
      toast({
        title: 'Rule deleted',
        description: 'Proxy rule has been deleted.',
      });
    } catch (err: unknown) {
      const errorMessage =
        (err as { data?: { message?: string } })?.data?.message || 'Failed to delete proxy rule';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
      throw err;
    }
  };

  const handleReorder = async (ruleIds: string[]) => {
    try {
      await reorderRules({ ruleSetId, ruleIds }).unwrap();
      toast({
        title: 'Rules reordered',
        description: 'Proxy rules order has been updated.',
      });
    } catch (err: unknown) {
      const errorMessage =
        (err as { data?: { message?: string } })?.data?.message || 'Failed to reorder proxy rules';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
      throw err;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Rules: {ruleSetName}</DialogTitle>
          <DialogDescription>
            Configure proxy rules for this rule set. Rules are evaluated in order.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4">
          <ProxyRulesEditor
            rules={data?.rules || []}
            isLoading={isLoading}
            error={error}
            scope="project"
            onCreateRule={handleCreateRule}
            onUpdateRule={handleUpdateRule}
            onDeleteRule={handleDeleteRule}
            onReorder={handleReorder}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
