import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
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
import { Plus, Pencil, Trash2, AlertCircle } from 'lucide-react';
import { useGetProjectQuery } from '@/services/projectsApi';
import { useProjectRole } from '@/hooks/useProjectRole';
import {
  useGetSchedulesQuery,
  useUpdateScheduleMutation,
  useDeleteScheduleMutation,
  type PipelineSchedule,
} from '@/services/pipelineSchedulesApi';
import { describeCron } from '@/utils/cron';
import { ScheduleFormDialog } from '@/components/pipeline-schedules/ScheduleFormDialog';
import { useToast } from '@/hooks/use-toast';

function relative(iso?: string): string {
  if (!iso) return '—';
  return formatDistanceToNow(new Date(iso), { addSuffix: true });
}

export function PipelineSchedulesPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const { toast } = useToast();
  const { canEdit } = useProjectRole(owner!, repo!);

  const { data: project } = useGetProjectQuery(
    { owner: owner!, name: repo! },
    { skip: !owner || !repo },
  );
  const projectId = project?.id ?? '';

  const { data: schedules = [], isLoading } = useGetSchedulesQuery(projectId, {
    skip: !projectId,
  });
  const [updateSchedule] = useUpdateScheduleMutation();
  const [deleteSchedule] = useDeleteScheduleMutation();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PipelineSchedule | undefined>(undefined);
  const [deleting, setDeleting] = useState<PipelineSchedule | null>(null);

  const openCreate = () => {
    setEditing(undefined);
    setFormOpen(true);
  };
  const openEdit = (schedule: PipelineSchedule) => {
    setEditing(schedule);
    setFormOpen(true);
  };

  const handleToggle = async (schedule: PipelineSchedule) => {
    try {
      await updateSchedule({
        id: schedule.id,
        projectId,
        data: { enabled: !schedule.enabled },
      }).unwrap();
    } catch (err: unknown) {
      const message =
        (err as { data?: { message?: string } })?.data?.message || 'Failed to update schedule';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteSchedule({ id: deleting.id, projectId }).unwrap();
      toast({ title: 'Schedule deleted', description: `"${deleting.name}" was removed.` });
    } catch (err: unknown) {
      const message =
        (err as { data?: { message?: string } })?.data?.message || 'Failed to delete schedule';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Schedules</h2>
          <p className="text-sm text-muted-foreground">
            Run pipeline rules automatically on a cron cadence.
          </p>
        </div>
        {canEdit && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-2" />
            New schedule
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : schedules.length === 0 ? (
        <div className="border rounded-lg p-8 text-center text-muted-foreground">
          <p className="font-medium">No schedules yet</p>
          <p className="text-sm mt-1">
            Create a schedule to run a pipeline rule on a recurring cadence.
          </p>
        </div>
      ) : (
        <TooltipProvider>
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Cron</TableHead>
                  <TableHead>Timezone</TableHead>
                  <TableHead>Last run</TableHead>
                  <TableHead>Next run</TableHead>
                  <TableHead>Enabled</TableHead>
                  {canEdit && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {schedules.map((schedule) => {
                  const description = describeCron(schedule.cronExpression);
                  return (
                    <TableRow key={schedule.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {schedule.name}
                          {schedule.lastError && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="destructive" className="gap-1">
                                  <AlertCircle className="h-3 w-3" />
                                  Error
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                {schedule.lastError}
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {description ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <code className="text-xs">{schedule.cronExpression}</code>
                            </TooltipTrigger>
                            <TooltipContent>{description}</TooltipContent>
                          </Tooltip>
                        ) : (
                          <code className="text-xs">{schedule.cronExpression}</code>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {schedule.timezone}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {relative(schedule.lastRunAt)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {schedule.enabled ? relative(schedule.nextRunAt) : '—'}
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={schedule.enabled}
                          disabled={!canEdit}
                          onCheckedChange={() => handleToggle(schedule)}
                        />
                      </TableCell>
                      {canEdit && (
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEdit(schedule)}
                              aria-label={`Edit ${schedule.name}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setDeleting(schedule)}
                              aria-label={`Delete ${schedule.name}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </TooltipProvider>
      )}

      {projectId && (
        <ScheduleFormDialog
          projectId={projectId}
          schedule={editing}
          open={formOpen}
          onOpenChange={setFormOpen}
        />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete schedule?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleting?.name}" will stop running. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
