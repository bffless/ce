import { BadRequestException, Injectable } from '@nestjs/common';
import type { AppManualStep } from './app-manifest.types';
import type { SyncRuleConflictDto } from '../proxy-rules/dto/sync-proxy-rule-set.dto';

export type InstallStepId =
  | 'preflight'
  | 'fetch'
  | 'sync-rules'
  | 'deploy'
  | 'domain'
  | 'certificate'
  | 'schedules'
  | 'record';

export interface InstallStepState {
  id: InstallStepId;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'action-required';
  detail?: string;
  error?: string;
}

export interface InstallJob {
  id: string;
  kind: 'install' | 'update';
  appId: string;
  /** null until the project is resolved (the `newProject` path). */
  projectId: string | null;
  status: 'running' | 'succeeded' | 'failed' | 'undone';
  steps: InstallStepState[];
  installedAppId?: string;
  /** Manifest steps filtered by `manualStepApplies`, plus cert-synthesized ones. */
  manualSteps?: AppManualStep[];
  appUrl?: string;
  /**
   * Rules an update left contested — the payload and a local edit changed the
   * same field, and (under the update path's `preserve` policy) the local value
   * was kept. Carried on the job so the dialog can offer a per-field choice
   * once the update has finished.
   */
  conflicts?: SyncRuleConflictDto[];
  error?: string;
  createdAt: string;
  finishedAt?: string;
}

/**
 * AppInstallJobsService — in-memory install/update job registry (Task 9 of the
 * app-catalog spec). Deliberately NOT persisted: a job is a live progress
 * view, while the durable record of what happened is the `installed_apps` row
 * the applier writes (which is what powers undo/resume across a restart).
 *
 * Single-flight by design: an app install touches nginx configs, aliases and
 * certificates, so two concurrent runs could interleave destructively. The
 * same shape as `StorageMigrationService` (one `currentMigration` at a time).
 */
@Injectable()
export class AppInstallJobsService {
  /** Bounded so a long-lived instance can't accumulate jobs forever. */
  private readonly MAX_JOBS = 20;
  private readonly jobs = new Map<string, InstallJob>();
  private activeJobId: string | null = null;

  create(kind: 'install' | 'update', appId: string, stepIds: InstallStepId[]): InstallJob {
    const active = this.activeJobId ? this.jobs.get(this.activeJobId) : undefined;
    if (active && active.status === 'running') {
      throw new BadRequestException(
        `An app ${active.kind} is already running (${active.appId}). Wait for it to finish before starting another.`,
      );
    }

    const job: InstallJob = {
      id: this.nextId(),
      kind,
      appId,
      projectId: null,
      status: 'running',
      steps: stepIds.map((id) => ({ id, status: 'pending' })),
      createdAt: new Date().toISOString(),
    };

    this.jobs.set(job.id, job);
    this.activeJobId = job.id;
    this.evictOldest();
    return job;
  }

  get(jobId: string): InstallJob | null {
    return this.jobs.get(jobId) ?? null;
  }

  /** The currently running job, if any — lets the UI resume polling after a reload. */
  getActive(): InstallJob | null {
    const active = this.activeJobId ? this.jobs.get(this.activeJobId) : undefined;
    return active && active.status === 'running' ? active : null;
  }

  /** Most recent job that produced/targeted the given `installed_apps` row. */
  findByInstalledApp(installedAppId: string): InstallJob | null {
    let found: InstallJob | null = null;
    for (const job of this.jobs.values()) {
      if (job.installedAppId === installedAppId) found = job; // insertion order = chronological
    }
    return found;
  }

  /** Stamped once the applier has resolved (or created) the target project. */
  setProjectId(jobId: string, projectId: string): void {
    const job = this.jobs.get(jobId);
    if (job) job.projectId = projectId;
  }

  setStep(jobId: string, step: InstallStepId, patch: Partial<InstallStepState>): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    const index = job.steps.findIndex((s) => s.id === step);
    if (index === -1) return;
    job.steps[index] = { ...job.steps[index], ...patch, id: step };
  }

  finish(jobId: string, status: InstallJob['status'], patch: Partial<InstallJob> = {}): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    Object.assign(job, patch, { status, finishedAt: new Date().toISOString() });
    if (this.activeJobId === jobId) this.activeJobId = null;
  }

  private nextId(): string {
    const base = `app-install-${Date.now()}`;
    if (!this.jobs.has(base)) return base;
    // Two jobs created inside the same millisecond (tests, fast retries).
    let suffix = 1;
    while (this.jobs.has(`${base}-${suffix}`)) suffix++;
    return `${base}-${suffix}`;
  }

  private evictOldest(): void {
    while (this.jobs.size > this.MAX_JOBS) {
      const oldest = this.jobs.keys().next().value;
      if (oldest === undefined || oldest === this.activeJobId) break;
      this.jobs.delete(oldest);
    }
  }
}
