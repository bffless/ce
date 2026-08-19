import { useEffect, useRef, useState } from 'react';
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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useToast } from '@/hooks/use-toast';
import { useAppDispatch } from '@/store/hooks';
import { api } from '@/services/api';
import {
  usePreflightAppMutation,
  useInstallAppMutation,
  useGetInstallJobQuery,
  useUndoJobMutation,
  type CatalogEntry,
  type GateResult,
  type InstallStepState,
  type PreflightRequest,
} from '@/services/appCatalogApi';
import { SetupNotes } from './SetupNotes';
import { ConflictResolver } from './ConflictResolver';
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
  /**
   * 'update' reuses this dialog's Working/Done screens for the Update flow
   * (AppCard fires `useUpdateAppMutation` itself and hands the resulting
   * jobId here via `initialJobId`) — the Review/project-picker screen is
   * install-only and is skipped entirely in this mode.
   */
  mode?: 'install' | 'update';
  /** When set, the dialog opens directly on the Working/Done screen for this job instead of Review. */
  initialJobId?: string;
}

const NEW_PROJECT_VALUE = 'new';

/**
 * Delay before a Review-screen keystroke (subdomain field, or the new-project
 * owner/name fields) re-fires preflight. `resetPreflight()` still runs
 * synchronously on every keystroke — that's what makes `canInstall` (which
 * requires `preflightData`) false for the whole debounce window, not just the
 * network round trip.
 */
const PREFLIGHT_DEBOUNCE_MS = 500;

/** Job statuses that will never change again — polling past this point is wasted work. */
const TERMINAL_JOB_STATUSES = new Set(['succeeded', 'failed', 'undone']);

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
export function InstallDialog({
  entry,
  open,
  onOpenChange,
  mode = 'install',
  initialJobId,
}: InstallDialogProps) {
  const { toast } = useToast();
  const dispatch = useAppDispatch();
  const isUpdate = mode === 'update';

  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(undefined);
  const [creatingNew, setCreatingNew] = useState(false);
  const [newOwner, setNewOwner] = useState('');
  const [newName, setNewName] = useState('');
  // Editable override for the manifest's default install subdomain. Starts
  // empty — the manifest default is only shown as a placeholder (see
  // `defaultSubdomainLabel` below), never forced into the field's value.
  const [subdomain, setSubdomain] = useState('');
  // Set the moment the operator types in the subdomain field. A server-side
  // suggestion (install-again: the default host is taken) may prefill the
  // field, but only while it is untouched — it must never overwrite typing.
  const [subdomainTouched, setSubdomainTouched] = useState(false);
  // Seeded once from the FIRST preflight response's appHost, so later
  // preflights (e.g. after a project change) don't keep overwriting a
  // placeholder the operator is already looking at.
  const [defaultSubdomainLabel, setDefaultSubdomainLabel] = useState<string | undefined>(undefined);
  const preflightDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Update mode is handed an already-running job — seed it directly so the
  // very first render lands on Working/Done, skipping Review entirely.
  const [jobId, setJobId] = useState<string | null>(initialJobId ?? null);
  const [installBody, setInstallBody] = useState<PreflightRequest | null>(null);

  const { data: reposData } = useGetMyRepositoriesQuery();
  const [preflight, { data: preflightData, isLoading: isPreflighting, reset: resetPreflight }] =
    usePreflightAppMutation();
  const [installApp, { isLoading: isInstalling }] = useInstallAppMutation();
  const [undoJob, { isLoading: isUndoing }] = useUndoJobMutation();

  // Stop polling once the job reaches a terminal state. `lastJobStatus` is
  // corrected synchronously during render (not in an effect) so the very
  // poll that observes the terminal status is also the one that disables
  // further polling — no one-more-poll-after-done straggler.
  const [lastJobStatus, setLastJobStatus] = useState<string | undefined>(undefined);
  const jobPollingInterval = lastJobStatus && TERMINAL_JOB_STATUSES.has(lastJobStatus) ? 0 : 1000;
  const { data: job } = useGetInstallJobQuery(jobId ?? '', {
    pollingInterval: jobPollingInterval,
    skip: !jobId,
  });
  if (job?.status !== lastJobStatus) {
    setLastJobStatus(job?.status);
  }

  // The catalog card (badge, version, "Update to vX") and this dialog's own
  // Done screen both read from the LIVE catalog entry (`entry.installed`),
  // which `installApp`/`updateApp` invalidate at DISPATCH time — before the
  // background job has done anything. Nothing re-invalidates when the job
  // actually finishes, so the card is stuck showing pre-update state until a
  // manual reload. Fix: invalidate again here, once per job, the moment a
  // poll observes a terminal status. Keyed by job id (not just status) so a
  // retried job that lands on the same terminal status as the one before it
  // still gets its own invalidation.
  const invalidatedJobIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!job || !TERMINAL_JOB_STATUSES.has(job.status)) return;
    if (invalidatedJobIdRef.current === job.id) return;
    invalidatedJobIdRef.current = job.id;
    dispatch(api.util.invalidateTags(['AppCatalog', 'InstalledApp']));
  }, [job, dispatch]);

  const repositories = reposData?.repositories ?? [];

  // Preselect the sole project; reset all wizard state whenever the dialog closes.
  useEffect(() => {
    if (!open) {
      setJobId(null);
      setInstallBody(null);
      setCreatingNew(false);
      setNewOwner('');
      setNewName('');
      setSubdomain('');
      setSubdomainTouched(false);
      setDefaultSubdomainLabel(undefined);
      setSelectedProjectId(undefined);
      setLastJobStatus(undefined);
      if (preflightDebounceRef.current) clearTimeout(preflightDebounceRef.current);
      return;
    }
    // Update mode never shows Review, so there's no project to preselect —
    // and preselecting one would trigger a pointless preflight call.
    if (!isUpdate && repositories.length === 1 && !selectedProjectId && !creatingNew) {
      setSelectedProjectId(repositories[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, repositories.length, isUpdate]);

  const trimmedSubdomain = subdomain.trim();
  const preflightBody: PreflightRequest | null = creatingNew
    ? newOwner.trim() && newName.trim()
      ? {
          newProject: { owner: newOwner.trim(), name: newName.trim() },
          ...(trimmedSubdomain ? { subdomain: trimmedSubdomain } : {}),
        }
      : null
    : selectedProjectId
      ? {
          projectId: selectedProjectId,
          ...(trimmedSubdomain ? { subdomain: trimmedSubdomain } : {}),
        }
      : null;

  const runPreflight = (body: PreflightRequest) => {
    preflight({ appId: entry.id, body });
  };

  useEffect(() => {
    if (!preflightBody) return;
    // Clear the previous result IMMEDIATELY (not debounced) so stale
    // gates/plan (and a stale "clean" verdict) can't be shown — or acted on
    // — against the newly-typed target while the debounced re-fire is
    // pending. `canInstall` requires `preflightData`, so this alone is what
    // keeps Install disabled for the whole debounce window, not just the
    // network round trip that follows it.
    resetPreflight();
    if (preflightDebounceRef.current) clearTimeout(preflightDebounceRef.current);
    preflightDebounceRef.current = setTimeout(() => {
      runPreflight(preflightBody);
    }, PREFLIGHT_DEBOUNCE_MS);
    return () => {
      if (preflightDebounceRef.current) clearTimeout(preflightDebounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId, creatingNew, newOwner, newName, trimmedSubdomain]);

  // Seed the placeholder default from the first preflight response only —
  // the manifest's default subdomain doesn't change across projects, so
  // later responses (from a project change, or the operator's own override)
  // must not keep stomping a placeholder already on screen.
  useEffect(() => {
    if (defaultSubdomainLabel === undefined && preflightData?.appHost) {
      setDefaultSubdomainLabel(preflightData.appHost.split('.')[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preflightData?.appHost]);

  // Install-again: the manifest's default host already belongs to another
  // install (typically this app in another project), so the backend proposes
  // a free `<default>-<project>` subdomain. Adopt it while the field is
  // untouched — that re-runs preflight with the override and clears the
  // collision gate without the operator having to invent a host.
  useEffect(() => {
    const suggested = preflightData?.suggestedSubdomain;
    if (suggested && !subdomainTouched && !trimmedSubdomain) {
      setSubdomain(suggested);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preflightData?.suggestedSubdomain]);

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

  // The Done screen reads the LIVE install this job produced (the catalog is
  // refetched on the job's terminal status), matched by the job's row id so a
  // second install of the same app never shows the first install's notes/URL.
  const jobInstall = job?.installedAppId
    ? entry.installs.find((install) => install.installedAppId === job.installedAppId)
    : undefined;
  const manualSteps = jobInstall?.manualSteps ?? job?.manualSteps ?? [];
  const doneAppUrl = jobInstall?.appUrl ?? job?.appUrl;
  const isInstallAgain = !isUpdate && entry.installs.length > 0;

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
      {/* The review screen grows with the number of preflight gates and synced
          rule sets, and DialogContent is vertically centred with no height cap
          of its own, so tall results pushed the title off the top of the
          viewport with no way to scroll. Cap and scroll instead. */}
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {screen === 'done'
              ? `${entry.name} ${isUpdate ? 'updated' : 'installed'}`
              : isUpdate
                ? `Updating ${entry.name}`
                : isInstallAgain
                  ? `Install ${entry.name} in another project`
                  : `Install ${entry.name}`}
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

            {preflightData?.appHost !== null && (
              <div className="space-y-2">
                <Label htmlFor="install-subdomain">Subdomain</Label>
                <Input
                  id="install-subdomain"
                  value={subdomain}
                  onChange={(e) => {
                    setSubdomainTouched(true);
                    setSubdomain(e.target.value);
                  }}
                  placeholder={defaultSubdomainLabel}
                />
                {isInstallAgain &&
                  defaultSubdomainLabel &&
                  trimmedSubdomain &&
                  trimmedSubdomain !== defaultSubdomainLabel && (
                    <p className="text-xs text-muted-foreground">
                      {describeDefaultHostOwner(entry, defaultSubdomainLabel)}
                    </p>
                  )}
                {preflightData?.appUrl && (
                  <p className="text-xs text-muted-foreground">
                    Will be available at <code className="text-xs">{preflightData.appUrl}</code>
                  </p>
                )}
              </div>
            )}

            {isPreflighting && !preflightData && (
              <p className="text-sm text-muted-foreground">Checking…</p>
            )}

            {preflightData && (
              <>
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
                  {step.status === 'action-required' && !isUpdate && (
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
                  <AlertDescription>
                    {job.error ?? (isUpdate ? 'Update failed.' : 'Install failed.')}
                  </AlertDescription>
                </Alert>
                {/*
                  Undo is install-only. A failed update's row carries the
                  ORIGINAL install's created resources, so undoing it would
                  delete that install outright — data tables included. An
                  update rolls back through the alias's deployment history
                  instead, which costs nothing and loses nothing.
                */}
                {isUpdate && (
                  <p className="text-sm text-muted-foreground">
                    Nothing was removed. The previous version is still in the alias&apos;s
                    deployment history — roll back there, or run the update again once the cause is
                    fixed.
                  </p>
                )}
                <DialogFooter>
                  <Button variant="outline" onClick={() => onOpenChange(false)}>
                    Close
                  </Button>
                  {!isUpdate && (
                    <Button variant="destructive" onClick={handleUndo} disabled={isUndoing}>
                      Undo this install
                    </Button>
                  )}
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

            {/* Mounted only when there's something to resolve — it subscribes to
                the proxy-rules API, and an update with no conflicts shouldn't. */}
            {(job?.conflicts?.length ?? 0) > 0 && <ConflictResolver conflicts={job!.conflicts!} />}

            <SetupNotes steps={manualSteps} defaultExpanded />

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
            <Button
              onClick={handleInstall}
              disabled={!canInstall || isInstalling || isPreflighting}
            >
              {isInstalling ? 'Installing…' : 'Install'}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * "`handoff.example.com` is used by the install in acme/site" — names which
 * existing install owns the manifest-default host, so a prefilled or hand-typed
 * alternative reads as deliberate rather than as the wizard ignoring the
 * default. Falls back to generic wording when no install's URL matches (the
 * default may be mapped by something that isn't this app).
 */
function describeDefaultHostOwner(entry: CatalogEntry, defaultSubdomain: string): string {
  const owner = entry.installs.find((install) => {
    if (!install.appUrl) return false;
    try {
      return new URL(install.appUrl).hostname.split('.')[0] === defaultSubdomain;
    } catch {
      return false;
    }
  });
  return owner
    ? `The default subdomain "${defaultSubdomain}" is used by the install in ${owner.projectName}.`
    : `The default subdomain "${defaultSubdomain}" is already in use.`;
}
