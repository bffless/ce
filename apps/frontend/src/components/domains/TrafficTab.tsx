import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Plus, Trash2, AlertCircle, BarChart3, Scale, Info, Search, Cookie } from 'lucide-react';
import {
  useGetTrafficConfigQuery,
  useSetTrafficWeightsMutation,
  useClearTrafficWeightsMutation,
  useGetAvailableAliasesQuery,
  useGetTrafficRulesQuery,
  useCreateTrafficRuleMutation,
  useUpdateTrafficRuleMutation,
  useDeleteTrafficRuleMutation,
} from '@/services/domainsApi';
import type { TrafficRule } from '@/services/domainsApi';
import { useToast } from '@/hooks/use-toast';

interface TrafficTabProps {
  domainId: string;
  domain: string;
}

interface WeightEntry {
  alias: string;
  weight: number;
}

export function TrafficTab({ domainId }: TrafficTabProps) {
  const { toast } = useToast();
  const { data: config, isLoading } = useGetTrafficConfigQuery(domainId);
  const { data: availableAliases = [] } = useGetAvailableAliasesQuery(domainId);
  const [setTrafficWeights, { isLoading: isSaving }] = useSetTrafficWeightsMutation();
  const [clearTrafficWeights, { isLoading: isClearing }] = useClearTrafficWeightsMutation();

  const [weights, setWeights] = useState<WeightEntry[]>([]);
  const [stickySessionsEnabled, setStickySessionsEnabled] = useState(true);
  const [stickySessionDuration, setStickySessionDuration] = useState(86400);
  const [hasChanges, setHasChanges] = useState(false);

  // Initialize from config
  useEffect(() => {
    if (config) {
      setWeights(config.weights.map((w) => ({ alias: w.alias, weight: w.weight })));
      setStickySessionsEnabled(config.stickySessionsEnabled);
      setStickySessionDuration(config.stickySessionDuration);
      setHasChanges(false);
    }
  }, [config]);

  const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
  const isValid = totalWeight === 100 || weights.length === 0;

  const handleAddWeight = () => {
    // Find first unused alias
    const usedAliases = new Set(weights.map((w) => w.alias));
    const unusedAlias = availableAliases.find((a) => !usedAliases.has(a));

    if (unusedAlias) {
      setWeights([...weights, { alias: unusedAlias, weight: 0 }]);
      setHasChanges(true);
    }
  };

  const handleRemoveWeight = (index: number) => {
    setWeights(weights.filter((_, i) => i !== index));
    setHasChanges(true);
  };

  const handleWeightChange = (index: number, weight: number) => {
    // Clamp weight between 0 and 100
    const clampedWeight = Math.max(0, Math.min(100, weight));
    const newWeights = [...weights];
    newWeights[index].weight = clampedWeight;
    setWeights(newWeights);
    setHasChanges(true);
  };

  const handleAliasChange = (index: number, alias: string) => {
    const newWeights = [...weights];
    newWeights[index].alias = alias;
    setWeights(newWeights);
    setHasChanges(true);
  };

  const handleSave = async () => {
    if (!isValid) {
      toast({
        title: 'Invalid configuration',
        description: 'Weights must sum to 100%',
        variant: 'destructive',
      });
      return;
    }

    try {
      await setTrafficWeights({
        domainId,
        body: {
          weights,
          stickySessionsEnabled,
          stickySessionDuration,
        },
      }).unwrap();
      toast({
        title: 'Success',
        description: 'Traffic configuration saved',
      });
      setHasChanges(false);
    } catch (error: unknown) {
      const errorMessage =
        (error as { data?: { message?: string } })?.data?.message ||
        'Failed to save configuration';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  const handleClear = async () => {
    if (!confirm('Clear all traffic weights and return to single alias mode?')) return;

    try {
      await clearTrafficWeights(domainId).unwrap();
      toast({
        title: 'Success',
        description: 'Traffic weights cleared',
      });
      setWeights([]);
      setHasChanges(false);
    } catch (error: unknown) {
      const errorMessage =
        (error as { data?: { message?: string } })?.data?.message || 'Failed to clear weights';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  // Auto-balance weights
  const handleAutoBalance = () => {
    if (weights.length === 0) return;
    const equalWeight = Math.floor(100 / weights.length);
    const remainder = 100 - equalWeight * weights.length;

    setWeights(
      weights.map((w, i) => ({
        ...w,
        weight: equalWeight + (i === 0 ? remainder : 0),
      })),
    );
    setHasChanges(true);
  };

  if (isLoading) {
    return <div className="p-4 text-muted-foreground">Loading traffic config...</div>;
  }

  if (availableAliases.length === 0) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          No deployment aliases found for this project. Create some deployments with aliases first
          to enable traffic splitting.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {/* Info about how this relates to General tab alias */}
      <Alert className="bg-blue-50 border-blue-200">
        <Info className="h-4 w-4 text-blue-600" />
        <AlertDescription className="text-blue-800">
          Traffic splitting overrides the alias set in the General tab. When enabled, traffic is
          distributed across the aliases configured below instead of going to a single alias.
        </AlertDescription>
      </Alert>

      <div>
        <h3 className="text-sm font-medium mb-1">Traffic Distribution</h3>
        <p className="text-sm text-muted-foreground">
          Split traffic across multiple deployment aliases for A/B testing or canary deployments.
        </p>
      </div>

      {/* Weight Entries */}
      <div className="space-y-2">
        {weights.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4 text-center border rounded-md bg-muted/30">
            No traffic splitting configured. Traffic goes to the alias set in the General tab.
          </div>
        ) : (
          weights.map((entry, index) => (
            <div
              key={index}
              className="flex items-center gap-2 p-2 border rounded-md bg-background"
            >
              <Select value={entry.alias} onValueChange={(v) => handleAliasChange(index, v)}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Select alias" />
                </SelectTrigger>
                <SelectContent>
                  {availableAliases.map((alias) => (
                    <SelectItem
                      key={alias}
                      value={alias}
                      disabled={weights.some((w, i) => w.alias === alias && i !== index)}
                    >
                      {alias}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  value={entry.weight}
                  onChange={(e) => handleWeightChange(index, parseInt(e.target.value) || 0)}
                  className="w-[70px] text-center"
                  min={0}
                  max={100}
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>

              {/* Visual bar */}
              <div className="flex-1 h-6 bg-muted rounded overflow-hidden min-w-[60px]">
                <div
                  className="h-full bg-primary/70 transition-all duration-200"
                  style={{ width: `${entry.weight}%` }}
                />
              </div>

              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => handleRemoveWeight(index)}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))
        )}
      </div>

      {/* Total & Validation */}
      {weights.length > 0 && (
        <div
          className={`flex items-center justify-between p-2 border rounded-md ${isValid ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}
        >
          <div className="flex items-center gap-2">
            <BarChart3 className={`h-4 w-4 ${isValid ? 'text-green-600' : 'text-red-600'}`} />
            <span className="font-medium text-sm">Total:</span>
            <span className={`font-bold ${isValid ? 'text-green-600' : 'text-red-600'}`}>
              {totalWeight}%
            </span>
          </div>
          {!isValid && (
            <div className="flex items-center gap-1 text-red-600 text-sm">
              <AlertCircle className="h-4 w-4" />
              <span>Must equal 100%</span>
            </div>
          )}
        </div>
      )}

      {/* Add/Balance Buttons */}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleAddWeight}
          disabled={weights.length >= availableAliases.length}
        >
          <Plus className="h-4 w-4 mr-1" />
          Add Alias
        </Button>
        {weights.length > 1 && (
          <Button variant="outline" size="sm" onClick={handleAutoBalance}>
            <Scale className="h-4 w-4 mr-1" />
            Auto-Balance
          </Button>
        )}
      </div>

      {/* Sticky Session Settings */}
      {weights.length > 0 && (
        <div className="border-t pt-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-medium">Sticky Sessions</h4>
              <p className="text-xs text-muted-foreground">
                Keep users on the same variant across page loads
              </p>
            </div>
            <Switch
              checked={stickySessionsEnabled}
              onCheckedChange={(v) => {
                setStickySessionsEnabled(v);
                setHasChanges(true);
              }}
            />
          </div>

          {stickySessionsEnabled && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="no-expiration"
                  checked={stickySessionDuration === 0}
                  onChange={(e) => {
                    setStickySessionDuration(e.target.checked ? 0 : 86400);
                    setHasChanges(true);
                  }}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <label htmlFor="no-expiration" className="text-sm">
                  No expiration
                </label>
              </div>
              {stickySessionDuration !== 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-sm">Duration:</span>
                  <Input
                    type="number"
                    value={Math.floor(stickySessionDuration / 3600)}
                    onChange={(e) => {
                      setStickySessionDuration(parseInt(e.target.value) * 3600 || 3600);
                      setHasChanges(true);
                    }}
                    className="w-20"
                    min={1}
                    max={720}
                  />
                  <span className="text-sm text-muted-foreground">hours</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-2 border-t">
        <Button
          onClick={handleSave}
          disabled={isSaving || !hasChanges || (!isValid && weights.length > 0)}
          size="sm"
        >
          {isSaving ? 'Saving...' : 'Save Changes'}
        </Button>
        {weights.length > 0 && (
          <Button variant="outline" size="sm" onClick={handleClear} disabled={isClearing}>
            Clear All
          </Button>
        )}
      </div>

      {/* Warning for no sticky sessions */}
      {!stickySessionsEnabled && weights.length > 0 && (
        <Alert variant="destructive" className="bg-amber-50 border-amber-200">
          <AlertCircle className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-800">
            Without sticky sessions, users may see different variants on each page load.
          </AlertDescription>
        </Alert>
      )}

      {/* Traffic Rules Section */}
      {weights.length > 0 && (
        <TrafficRulesSection domainId={domainId} availableAliases={availableAliases} weightAliases={weights.map((w) => w.alias)} />
      )}
    </div>
  );
}

// =====================
// Traffic Rules Section
// =====================

interface TrafficRulesSectionProps {
  domainId: string;
  availableAliases: string[];
  weightAliases: string[];
}

function TrafficRulesSection({ domainId, availableAliases, weightAliases }: TrafficRulesSectionProps) {
  const { toast } = useToast();
  const { data: rules = [] } = useGetTrafficRulesQuery(domainId);
  const [createRule, { isLoading: isCreating }] = useCreateTrafficRuleMutation();
  const [updateRule] = useUpdateTrafficRuleMutation();
  const [deleteRule] = useDeleteTrafficRuleMutation();

  const [showAddForm, setShowAddForm] = useState(false);
  const [newRule, setNewRule] = useState({
    conditionType: 'query_param' as 'query_param' | 'cookie',
    conditionKey: '',
    conditionValue: '',
    alias: '',
    label: '',
  });

  const handleCreate = async () => {
    if (!newRule.conditionKey || !newRule.conditionValue || !newRule.alias) {
      toast({
        title: 'Missing fields',
        description: 'Type, key, value, and alias are required',
        variant: 'destructive',
      });
      return;
    }

    try {
      await createRule({
        domainId,
        body: {
          conditionType: newRule.conditionType,
          conditionKey: newRule.conditionKey,
          conditionValue: newRule.conditionValue,
          alias: newRule.alias,
          label: newRule.label || undefined,
        },
      }).unwrap();
      toast({ title: 'Success', description: 'Traffic rule created' });
      setShowAddForm(false);
      setNewRule({
        conditionType: 'query_param',
        conditionKey: '',
        conditionValue: '',
        alias: '',
        label: '',
      });
    } catch (error: unknown) {
      const errorMessage =
        (error as { data?: { message?: string } })?.data?.message || 'Failed to create rule';
      toast({ title: 'Error', description: errorMessage, variant: 'destructive' });
    }
  };

  const handleToggleActive = async (rule: TrafficRule) => {
    try {
      await updateRule({
        ruleId: rule.id,
        domainId,
        body: { isActive: !rule.isActive },
      }).unwrap();
    } catch (error: unknown) {
      const errorMessage =
        (error as { data?: { message?: string } })?.data?.message || 'Failed to update rule';
      toast({ title: 'Error', description: errorMessage, variant: 'destructive' });
    }
  };

  const handleDelete = async (rule: TrafficRule) => {
    if (!confirm('Delete this traffic rule?')) return;

    try {
      await deleteRule({ ruleId: rule.id, domainId }).unwrap();
      toast({ title: 'Success', description: 'Traffic rule deleted' });
    } catch (error: unknown) {
      const errorMessage =
        (error as { data?: { message?: string } })?.data?.message || 'Failed to delete rule';
      toast({ title: 'Error', description: errorMessage, variant: 'destructive' });
    }
  };

  return (
    <div className="border-t pt-4 space-y-3">
      <div>
        <h4 className="text-sm font-medium">Traffic Rules</h4>
        <p className="text-xs text-muted-foreground">
          Rules override weighted distribution. When a condition matches, the visitor is forced to
          that alias. First matching rule wins.
        </p>
      </div>

      {/* Existing Rules */}
      {rules.length > 0 && (
        <div className="space-y-2">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className={`flex items-center gap-2 p-2 border rounded-md ${rule.isActive ? 'bg-background' : 'bg-muted/50 opacity-60'}`}
            >
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                {rule.conditionType === 'query_param' ? (
                  <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                ) : (
                  <Cookie className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                )}
                <span className="text-sm truncate">
                  <span className="text-muted-foreground">
                    {rule.conditionType === 'query_param' ? 'Query param' : 'Cookie'}
                  </span>{' '}
                  <code className="text-xs bg-muted px-1 py-0.5 rounded">{rule.conditionKey}</code>
                  {' = '}
                  <code className="text-xs bg-muted px-1 py-0.5 rounded">
                    {rule.conditionValue}
                  </code>
                  {' \u2192 '}
                  <span className="font-medium">{rule.alias}</span>
                </span>
                {!weightAliases.includes(rule.alias) && (
                  <span className="text-xs text-amber-600 ml-1 shrink-0">(rule-only)</span>
                )}
                {rule.label && (
                  <span className="text-xs text-muted-foreground ml-1 truncate">
                    ({rule.label})
                  </span>
                )}
              </div>
              <Switch
                checked={rule.isActive}
                onCheckedChange={() => handleToggleActive(rule)}
                className="shrink-0"
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => handleDelete(rule)}
              >
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Add Rule Button / Form */}
      {!showAddForm ? (
        <Button variant="outline" size="sm" onClick={() => setShowAddForm(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Add Rule
        </Button>
      ) : (
        <div className="border rounded-md p-3 space-y-3 bg-muted/30">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium mb-1 block">Type</label>
              <Select
                value={newRule.conditionType}
                onValueChange={(v) =>
                  setNewRule({ ...newRule, conditionType: v as 'query_param' | 'cookie' })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="query_param">Query Parameter</SelectItem>
                  <SelectItem value="cookie">Cookie</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Alias</label>
              <Select
                value={newRule.alias}
                onValueChange={(v) => setNewRule({ ...newRule, alias: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select alias" />
                </SelectTrigger>
                <SelectContent>
                  {availableAliases.map((alias) => (
                    <SelectItem key={alias} value={alias}>
                      {alias}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium mb-1 block">Key</label>
              <Input
                placeholder="e.g. token"
                value={newRule.conditionKey}
                onChange={(e) => setNewRule({ ...newRule, conditionKey: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Value</label>
              <Input
                placeholder="e.g. Ta-2ClB9"
                value={newRule.conditionValue}
                onChange={(e) => setNewRule({ ...newRule, conditionValue: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block">Label (optional)</label>
            <Input
              placeholder="e.g. Share link for recruiter"
              value={newRule.label}
              onChange={(e) => setNewRule({ ...newRule, label: e.target.value })}
            />
          </div>
          {newRule.alias && !weightAliases.includes(newRule.alias) && (
            <p className="text-xs text-amber-600">
              &ldquo;{newRule.alias}&rdquo; is not in the traffic distribution above. Only visitors matching this rule will see it &mdash; it won&apos;t appear in the random rotation.
            </p>
          )}
          <div className="flex gap-2">
            <Button size="sm" onClick={handleCreate} disabled={isCreating}>
              {isCreating ? 'Saving...' : 'Save Rule'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowAddForm(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
