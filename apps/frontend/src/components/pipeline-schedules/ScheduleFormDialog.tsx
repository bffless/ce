import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useGetPipelineRuleOptionsQuery,
  useCreateScheduleMutation,
  useUpdateScheduleMutation,
  type PipelineSchedule,
} from '@/services/pipelineSchedulesApi';
import { describeCron, isValidCron, CRON_PRESETS } from '@/utils/cron';
import { useToast } from '@/hooks/use-toast';

interface ScheduleFormDialogProps {
  projectId: string;
  schedule?: PipelineSchedule;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// IANA zones for the timezone picker; UTC first so it's the obvious default.
function timezoneOptions(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  const all = intl.supportedValuesOf ? intl.supportedValuesOf('timeZone') : [];
  return ['UTC', ...all.filter((z) => z !== 'UTC')];
}

export function ScheduleFormDialog({
  projectId,
  schedule,
  open,
  onOpenChange,
}: ScheduleFormDialogProps) {
  const { toast } = useToast();
  const isEdit = !!schedule;

  const [name, setName] = useState('');
  const [targetProxyRuleId, setTargetProxyRuleId] = useState('');
  const [cronExpression, setCronExpression] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [enabled, setEnabled] = useState(true);
  const [nameError, setNameError] = useState('');

  const { data: ruleOptions = [] } = useGetPipelineRuleOptionsQuery(projectId, {
    skip: !open,
  });
  const [createSchedule, { isLoading: isCreating }] = useCreateScheduleMutation();
  const [updateSchedule, { isLoading: isUpdating }] = useUpdateScheduleMutation();
  const isSaving = isCreating || isUpdating;

  // Load values on open (edit) or reset to defaults (create).
  useEffect(() => {
    if (!open) return;
    if (schedule) {
      setName(schedule.name);
      setTargetProxyRuleId(schedule.targetProxyRuleId);
      setCronExpression(schedule.cronExpression);
      setTimezone(schedule.timezone);
      setEnabled(schedule.enabled);
    } else {
      setName('');
      setTargetProxyRuleId('');
      setCronExpression('');
      setTimezone('UTC');
      setEnabled(true);
    }
    setNameError('');
  }, [open, schedule]);

  const cronDescription = useMemo(() => describeCron(cronExpression), [cronExpression]);
  const cronValid = cronDescription !== null;
  const timezones = useMemo(timezoneOptions, []);

  const canSubmit =
    name.trim().length > 0 && cronValid && (isEdit || targetProxyRuleId.length > 0) && !isSaving;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setNameError('Name is required');
      return;
    }
    if (!isValidCron(cronExpression) || (!isEdit && !targetProxyRuleId)) {
      return;
    }

    try {
      if (isEdit && schedule) {
        await updateSchedule({
          id: schedule.id,
          projectId,
          data: { name: name.trim(), cronExpression: cronExpression.trim(), timezone, enabled },
        }).unwrap();
        toast({ title: 'Schedule updated', description: `"${name}" has been updated.` });
      } else {
        await createSchedule({
          projectId,
          data: {
            name: name.trim(),
            targetProxyRuleId,
            cronExpression: cronExpression.trim(),
            timezone,
            enabled,
          },
        }).unwrap();
        toast({ title: 'Schedule created', description: `"${name}" has been created.` });
      }
      onOpenChange(false);
    } catch (err: unknown) {
      const message =
        (err as { data?: { message?: string } })?.data?.message || 'Failed to save schedule';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    }
  };

  const noRules = !isEdit && ruleOptions.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Schedule' : 'New Schedule'}</DialogTitle>
          <DialogDescription>
            Run a pipeline on a cron cadence. Times are evaluated in the selected timezone.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label htmlFor="schedule-name">Name *</Label>
            <Input
              id="schedule-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Refresh feeds every 15 min"
              maxLength={100}
              className={nameError ? 'border-destructive' : ''}
            />
            {nameError && <p className="text-xs text-destructive">{nameError}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="schedule-target">Target pipeline rule *</Label>
            {noRules ? (
              <p className="text-xs text-muted-foreground">
                No pipeline rules exist in this project yet. Create one under Proxy Rules first.
              </p>
            ) : (
              <Select
                value={targetProxyRuleId}
                onValueChange={setTargetProxyRuleId}
                disabled={isEdit}
              >
                <SelectTrigger id="schedule-target">
                  <SelectValue placeholder="Select a pipeline rule" />
                </SelectTrigger>
                <SelectContent>
                  {ruleOptions.map((rule) => (
                    <SelectItem key={rule.id} value={rule.id}>
                      {rule.name} ({rule.ruleSetName})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {isEdit && (
              <p className="text-xs text-muted-foreground">
                The target rule can't be changed after creation.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="schedule-cron">Cron expression *</Label>
            <Input
              id="schedule-cron"
              value={cronExpression}
              onChange={(e) => setCronExpression(e.target.value)}
              placeholder="*/15 * * * *"
              className={cronExpression && !cronValid ? 'border-destructive' : ''}
            />
            <div className="flex flex-wrap gap-1">
              {CRON_PRESETS.map((preset) => (
                <Button
                  key={preset.value}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setCronExpression(preset.value)}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
            {cronExpression && (
              <p className={`text-xs ${cronValid ? 'text-muted-foreground' : 'text-destructive'}`}>
                {cronValid ? cronDescription : 'Invalid cron expression'}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="schedule-tz">Timezone</Label>
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger id="schedule-tz">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                {timezones.map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {tz}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="schedule-enabled">Enabled</Label>
            <Switch id="schedule-enabled" checked={enabled} onCheckedChange={setEnabled} />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {isEdit
                ? isSaving
                  ? 'Saving...'
                  : 'Save Changes'
                : isSaving
                  ? 'Creating...'
                  : 'Create Schedule'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
