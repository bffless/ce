import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useToast } from '@/hooks/use-toast';
import {
  usePreflightAppMutation,
  useInstallAppMutation,
  useGetInstallJobQuery,
  useUndoJobMutation,
  useAckManualStepMutation,
  type CatalogEntry,
  type GateResult,
  type InstallStepState,
  type PreflightRequest,
} from '@/services/appCatalogApi';
import { useGetMyRepositoriesQuery } from '@/services/repositoriesApi';
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  ExternalLink,
  HelpCircle,
  Loader2,
  MinusCircle,
  XCircle,
} from 'lucide-react';

interface InstallDialogProps {
  entry: CatalogEntry;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const NEW_PROJECT_VALUE = 'new';

const STEP_LABELS: Record<string, string> = {
  preflight: 'Preflight checks',
  fetch: 'Fetch app bundle',
  'sync-rules': 'Sync proxy rules',
  deploy: 'Deploy',
  domain: 'Configure domain',
  certificate: 'Provision certificate',
  schedules: 'Set up schedules',
  record: 'Record install',
};

function GateIcon({ status }: { status: GateResult['status'] }) {
  if (status === 'fail') return <XCircle className="h-4 w-4 text-destructive shrink-0" />;
  if (status === 'warn') return <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />;
  return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />;
}

function StepIcon({ status }: { status: InstallStepState['status'] }) {
  switch (status) {
    case 'done':
      return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />;
    case 'failed':
      return <XCircle className="h-4 w-4 text-destructive shrink-0" />;
    case 'running':
      return <Loader2 className="h-4 w-4 animate-spin text-blue-500 shrink-0" />;
    case 'action-required':
      return <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />;
    case 'skipped':
      return <MinusCircle className="h-4 w-4 text-muted-foreground shrink-0" />;
    default:
      return <Circle className="h-4 w-4 text-muted-foreground shrink-0" />;
  }
}

/**
 * InstallDialog — the three-screen 1-click install wizard (Task 13 of the
 * app-catalog spec): Review (project pick + preflight) -> Working (live job
 * progress) -> Done (app URL + manual-steps checklist). Consumes Task 12's
 * `appCatalogApi` hooks; nothing is installed until the user has seen the
 * preflight plan and clicked Install.
 */
export function InstallDialog({ entry, open, onOpenChange }: InstallDialogProps) {
  const { toast } = useToast();

  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(undefined);
  const [creatingNew, setCreatingNew] = useState(false);
  const [newOwner, setNewOwner] = useState('');
  const [newName, setNewName] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [installBody, setInstallBody] = useState<PreflightRequest | null>(null);

  const { data: reposData } = useGetMyRepositoriesQuery();
  const [preflight, { data: preflightData, isLoading: isPreflighting }] = usePreflightAppMutation();
  const [installApp, { isLoading: isInstalling }] = useInstallAppMutation();
  const { data: job } = useGetInstallJobQuery(jobId ?? '', { pollingInterval: 1000, skip: !jobId });
  const [undoJob, { isLoading: isUndoing }] = useUndoJobMutation();
  const [ackManualStep] = useAckManualStepMutation();

  const repositories = reposData?.repositories ?? [];

  // Preselect the sole project; reset all wizard state whenever the dialog closes.
  useEffect(() => {
    if (!open) {
      setJobId(null);
      setInstallBody(null);
      setCreatingNew(false);
      setNewOwner('');
      setNewName('');
      setSelectedProjectId(undefined);
      return;
    }
    if (repositories.length === 1 && !selectedProjectId && !creatingNew) {
      setSelectedProjectId(repositories[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, repositories.length]);

  const preflightBody: PreflightRequest | null = creatingNew
    ? newOwner.trim() && newName.trim()
      ? { newProject: { owner: newOwner.trim(), name: newName.trim() } }
      : null
    : selectedProjectId
      ? { projectId: selectedProjectId }
      : null;

  const runPreflight = (body: PreflightRequest) => {
    preflight({ appId: entry.id, body });
  };

  useEffect(() => {
    if (preflightBody) {
      runPreflight(preflightBody);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId, creatingNew, newOwner, newName]);

  const handleProjectChange = (value: string) => {
    if (value === NEW_PROJECT_VALUE) {
      setCreatingNew(true);
      setSelectedProjectId(undefined);
    } else {
      setCreatingNew(false);
      setSelectedProjectId(value);
    }
  };

  const hasFailingGate = (preflightData?.gates ?? []).some((gate) => gate.status === 'fail');
  const canInstall = Boolean(preflightData) && !hasFailingGate && Boolean(preflightBody);

  const handleInstall = async () => {
    if (!preflightBody) return;
    try {
      const result = await installApp({ appId: entry.id, body: preflightBody }).unwrap();
      setInstallBody(preflightBody);
      setJobId(result.jobId);
    } catch (err) {
      const message = (err as { data?: { message?: string } })?.data?.message ?? 'Install failed';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    }
  };

  const handleRetryInstall = () => {
    if (!installBody) return;
    installApp({ appId: entry.id, body: installBody })
      .unwrap()
      .then((result) => setJobId(result.jobId))
      .catch(() => undefined);
  };

  const handleUndo = () => {
    if (!jobId) return;
    undoJob(jobId);
  };

  const installedAppId = entry.installed?.installedAppId ?? job?.installedAppId;
  const manualSteps = entry.installed?.manualSteps ?? job?.manualSteps ?? [];
  const manualStepsAcked = entry.installed?.manualStepsAcked ?? [];
  const doneAppUrl = entry.installed?.appUrl ?? job?.appUrl;

  const handleAck = (stepId: string, checked: boolean) => {
    if (!checked || !installedAppId) return;
    ackManualStep({ id: installedAppId, stepId });
  };

  const screen: 'review' | 'working' | 'done' = !jobId
    ? 'review'
    : job?.status === 'succeeded'
      ? 'done'
      : 'working';

  const allResolutions = (preflightData?.syncPlans ?? []).flatMap((plan) => plan.schemaResolutions);
  const reusedCount = allResolutions.filter((r) => r.action === 'reuse').length;
  const createdCount = allResolutions.filter((r) => r.action === 'create').length;
  const mismatches = allResolutions.filter((r) => r.fieldMismatch);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {screen === 'done' ? `${entry.name} installed` : `Install ${entry.name}`}
          </DialogTitle>
          {screen === 'review' && (
            <DialogDescription>
              Review what will change before anything is written.
            </DialogDescription>
          )}
        </DialogHeader>

        {screen === 'review' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="install-project">Project</Label>
              <select
                id="install-project"
                aria-label="Project"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                value={creatingNew ? NEW_PROJECT_VALUE : (selectedProjectId ?? '')}
                onChange={(e) => handleProjectChange(e.target.value)}
              >
                <option value="" disabled>
                  Choose a project
                </option>
                {repositories.map((repo) => (
                  <option key={repo.id} value={repo.id}>
                    {`${repo.owner}/${repo.name}`}
                  </option>
                ))}
                <option value={NEW_PROJECT_VALUE}>Create new project…</option>
              </select>
            </div>

            {creatingNew && (
              <div className="space-y-3 rounded-md border p-3">
                <div className="space-y-2">
                  <Label htmlFor="install-new-owner">Owner</Label>
                  <Input
                    id="install-new-owner"
                    value={newOwner}
                    onChange={(e) => setNewOwner(e.target.value)}
                    placeholder="your-org"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="install-new-name">Name</Label>
                  <Input
                    id="install-new-name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="handoff"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  A project&apos;s owner/name can never be renamed.
                </p>
              </div>
            )}

            {isPreflighting && !preflightData && (
              <p className="text-sm text-muted-foreground">Checking…</p>
            )}

            {preflightData && (
              <>
                {preflightData.appUrl && (
                  <p className="text-sm">
                    App URL: <code className="text-xs">{preflightData.appUrl}</code>
                  </p>
                )}

                <div className="space-y-2">
                  {preflightData.gates.map((gate) => (
                    <div key={gate.id} className="flex items-start gap-2 rounded-md border p-2">
                      <GateIcon status={gate.status} />
                      <p className="flex-1 text-sm">{gate.message}</p>
                      {(gate.remediation || gate.deepLink) && (
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button variant="ghost" size="sm" aria-label="Why?">
                              <HelpCircle className="h-4 w-4 mr-1" />
                              Why?
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent>
                            {gate.remediation && <p className="text-sm">{gate.remediation}</p>}
                            {gate.deepLink && (
                              <a
                                href={gate.deepLink}
                                className="text-sm text-primary underline mt-2 inline-block"
                              >
                                Fix it now
                              </a>
                            )}
                          </PopoverContent>
                        </Popover>
                      )}
                      {gate.retryable && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isPreflighting || !preflightBody}
                          onClick={() => preflightBody && runPreflight(preflightBody)}
                        >
                          Retry
                        </Button>
                      )}
                    </div>
                  ))}
                </div>

                {preflightData.syncPlans.length > 0 && (
                  <div className="space-y-2">
                    {preflightData.syncPlans.map((plan) => (
                      <div key={plan.ruleSet} className="text-sm">
                        <span className="font-medium">{plan.ruleSet}</span>
                        {': '}
                        <span className="text-muted-foreground">
                          {`${plan.created} rules created · ${plan.updated} updated`}
                        </span>
                      </div>
                    ))}

                    {allResolutions.length > 0 && (
                      <p className="text-sm text-muted-foreground">
                        {`${allResolutions.length} data tables: ${reusedCount} reused, ${createdCount} created`}
                      </p>
                    )}

                    {mismatches.map((resolution) => (
                      <Alert key={resolution.name}>
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription>
                          {`${resolution.name}: existing schema has a field mismatch — install won't overwrite it.`}
                        </AlertDescription>
                      </Alert>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {screen === 'working' && job && (
          <div className="space-y-4">
            <div className="space-y-2">
              {job.steps.map((step) => (
                <div key={step.id} className="flex items-start gap-2 rounded-md border p-2">
                  <StepIcon status={step.status} />
                  <div className="flex-1">
                    <p className="text-sm">{STEP_LABELS[step.id] ?? step.id}</p>
                    {step.detail && <p className="text-xs text-muted-foreground">{step.detail}</p>}
                    {step.error && <p className="text-xs text-destructive">{step.error}</p>}
                  </div>
                  {step.status === 'action-required' && (
                    <Button variant="outline" size="sm" onClick={handleRetryInstall}>
                      Retry
                    </Button>
                  )}
                </div>
              ))}
            </div>

            {job.status === 'failed' && (
              <>
                <Alert variant="destructive">
                  <AlertDescription>{job.error ?? 'Install failed.'}</AlertDescription>
                </Alert>
                <DialogFooter>
                  <Button variant="outline" onClick={() => onOpenChange(false)}>
                    Close
                  </Button>
                  <Button variant="destructive" onClick={handleUndo} disabled={isUndoing}>
                    Undo this install
                  </Button>
                </DialogFooter>
              </>
            )}
          </div>
        )}

        {screen === 'done' && (
          <div className="space-y-4">
            {doneAppUrl && (
              <Button asChild>
                <a href={doneAppUrl} target="_blank" rel="noopener noreferrer">
                  Open
                  <ExternalLink className="h-4 w-4 ml-1" />
                </a>
              </Button>
            )}

            {manualSteps.length > 0 && (
              <div className="space-y-3">
                <p className="text-sm font-medium">Finish setting up</p>
                {manualSteps.map((step) => (
                  <div key={step.id} className="flex items-start gap-2 rounded-md border p-2">
                    <Checkbox
                      id={`manual-step-${step.id}`}
                      aria-label={step.title}
                      checked={manualStepsAcked.includes(step.id)}
                      onCheckedChange={(checked) => handleAck(step.id, checked === true)}
                    />
                    <div className="flex-1">
                      <Label htmlFor={`manual-step-${step.id}`} className="font-medium">
                        {step.title}
                      </Label>
                      <p className="text-sm text-muted-foreground">{step.body}</p>
                      {step.deepLink && (
                        <a href={step.deepLink} className="text-sm text-primary underline">
                          Go
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Close</Button>
            </DialogFooter>
          </div>
        )}

        {screen === 'review' && (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleInstall} disabled={!canInstall || isInstalling}>
              {isInstalling ? 'Installing…' : 'Install'}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
