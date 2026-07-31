import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validateSync, type ValidationError } from 'class-validator';
import { and, eq } from 'drizzle-orm';
import { zipSync } from 'fflate';
import { db } from '../db/client';
import {
  deploymentAliases,
  installedApps,
  proxyRuleSets,
  type CreatedResources,
  type InstalledApp,
} from '../db/schema';
import { DeploymentsService } from '../deployments/deployments.service';
import { DomainsService } from '../domains/domains.service';
import { PipelineSchedulesService } from '../pipeline-schedules/pipeline-schedules.service';
import { PipelineSchemasService } from '../pipelines/pipeline-schemas.service';
import { ProjectsService } from '../projects/projects.service';
import { ProxyRuleSetsService } from '../proxy-rules/proxy-rule-sets.service';
import { SyncProxyRuleSetDto } from '../proxy-rules/dto/sync-proxy-rule-set.dto';
import { IStorageAdapter, STORAGE_ADAPTER } from '../storage/storage.interface';
import { resolveLocalAdapter } from '../storage/local.adapter';
import { AppBundleService, type LoadedBundle } from './app-bundle.service';
import { AppCertStepService } from './app-cert-step.service';
import { AppInstallJobsService, type InstallStepId } from './app-install-jobs.service';
import { AppPreflightService, type GateResult } from './app-preflight.service';
import { manualStepApplies } from './app-manifest.util';
import type { AppManifest, AppManualStep, AppRegistryEntry } from './app-manifest.types';

export interface InstallTarget {
  projectId?: string;
  newProject?: { owner: string; name: string };
}

export interface UninstallSummary {
  removed: {
    ruleSets: number;
    alias: boolean;
    domain: boolean;
    deployment: boolean;
    schedules: number;
  };
  dataTables: {
    /** Table names left in place — every reused table, plus created tables when `deleteData` is false. */
    kept: string[];
    /** Table names actually dropped (`deleteData: true`, created-by-install tables only). */
    deleted: string[];
    /** Record count captured (via `getByIdWithCount`) BEFORE each deleted table was dropped. */
    deletedRecordCounts: Record<string, number>;
  };
  note: string;
  /** `kind:id` labels of deletions that failed. Absent/omitted when everything succeeded. */
  failures?: string[];
}

export interface UninstallPreview {
  dataTables: Array<{ name: string; recordCount: number; createdByInstall: boolean }>;
}

const INSTALL_STEPS: InstallStepId[] = [
  'preflight',
  'fetch',
  'sync-rules',
  'deploy',
  'domain',
  'certificate',
  'schedules',
  'record',
];

/**
 * An update re-verifies the INSTANCE gates only. A registry bump can raise
 * `requires.ceMin`/`presignedStorage`, and an app that installed cleanly a
 * month ago is not automatically still installable today. Project gates are
 * deliberately absent: the target project, alias, domain and rule sets are
 * this install's own by definition, so a collision check against them would
 * fail on every update.
 */
const UPDATE_STEPS: InstallStepId[] = ['preflight', 'fetch', 'sync-rules', 'deploy', 'record'];

interface ParsedRuleSet {
  file: string;
  name: string;
  /** Attach the synced set to the app's alias (manifest default: true). */
  attach: boolean;
  dto: SyncProxyRuleSetDto;
}

interface ProjectRef {
  id: string;
  owner: string;
  name: string;
}

/**
 * Everything a step can produce that must survive a crash. Written to the
 * `installed_apps` row at every step boundary AND on the failure path — undo
 * walks `createdResources`, so state that only lived in memory would orphan
 * whatever the failed run had already created.
 */
interface InstallProgress {
  created: CreatedResources;
  ruleSetIds: string[];
  schemaIds: string[];
  deploymentId?: string;
  domainId?: string;
}

/**
 * AppInstallerService — the applier behind 1-click install (Task 9 of the
 * app-catalog spec).
 *
 * Every step is individually reported on the job AND individually idempotent,
 * so re-running an install over a `failed` row is a resume rather than a
 * duplicate. The durable record is the `installed_apps` row, written with
 * `status: 'installing'` BEFORE the first project-scoped write — it survives a
 * crash/restart and is what {@link undo} replays in reverse.
 *
 * Two invariants worth stating out loud:
 *  - **Nothing is written that preflight didn't just re-verify.** The wizard
 *    already showed the gates, but the job re-runs them; a `fail` aborts
 *    before the row insert.
 *  - **`createdResources` is the deletion boundary.** Only objects this
 *    install actually created land there (a rule set the sync ADOPTED, or a
 *    schema it REUSED, never does), so undo/uninstall can never delete a
 *    user's pre-existing data.
 */
@Injectable()
export class AppInstallerService {
  private readonly logger = new Logger(AppInstallerService.name);
  /** Resolves when the (single-flight) background run finishes. Never rejects. */
  private currentRun: Promise<void> = Promise.resolve();

  constructor(
    private readonly jobs: AppInstallJobsService,
    private readonly bundleService: AppBundleService,
    private readonly preflightService: AppPreflightService,
    private readonly certStepService: AppCertStepService,
    private readonly ruleSetsService: ProxyRuleSetsService,
    private readonly deploymentsService: DeploymentsService,
    private readonly domainsService: DomainsService,
    private readonly projectsService: ProjectsService,
    private readonly schedulesService: PipelineSchedulesService,
    private readonly schemasService: PipelineSchemasService,
    private readonly configService: ConfigService,
    @Inject(STORAGE_ADAPTER) private readonly storageAdapter: IStorageAdapter,
  ) {}

  /**
   * Kicks off the background run; returns immediately (storage-migration
   * shape). `subdomainOverride` is the SAME value the wizard's last preflight
   * showed — it is passed straight through to the job's own re-preflight
   * (`runInstall`), so the job never re-verifies a different host than the
   * one the operator was shown.
   */
  startInstall(
    entry: AppRegistryEntry,
    target: InstallTarget,
    userId: string,
    subdomainOverride?: string,
  ): { jobId: string } {
    const job = this.jobs.create('install', entry.id, INSTALL_STEPS);
    this.currentRun = this.runInstall(job.id, entry, target, userId, subdomainOverride);
    void this.currentRun;
    return { jobId: job.id };
  }

  startUpdate(
    installed: InstalledApp,
    entry: AppRegistryEntry,
    userId: string,
    opts: { prune: boolean },
  ): { jobId: string } {
    const job = this.jobs.create('update', entry.id, UPDATE_STEPS);
    this.jobs.setProjectId(job.id, installed.projectId);
    this.currentRun = this.runUpdate(job.id, installed, entry, userId, opts);
    void this.currentRun;
    return { jobId: job.id };
  }

  /** Awaits the in-flight background run (tests, graceful shutdown). */
  async whenIdle(): Promise<void> {
    await this.currentRun;
  }

  // ==================== install ====================

  private async runInstall(
    jobId: string,
    entry: AppRegistryEntry,
    target: InstallTarget,
    userId: string,
    subdomainOverride?: string,
  ): Promise<void> {
    let step: InstallStepId = 'preflight';
    let rowId: string | undefined;
    // Accumulated state, persisted at every step boundary (see persistProgress)
    // and carried into the failure write so a crashed install stays undoable.
    let progress: InstallProgress | undefined;

    try {
      // ---- 1. preflight: re-verify every gate before anything is written ----
      this.jobs.setStep(jobId, step, { status: 'running' });
      this.assertGatesPass(await this.preflightService.instanceGates(entry.requires));
      const preflightBundle = await this.bundleService.fetchBundle(entry.bundleUrl, entry.sha256);
      const projectGates = await this.preflightService.projectGates(
        preflightBundle,
        this.toPreflightTarget(target),
        userId,
        subdomainOverride,
      );
      this.assertGatesPass(projectGates.gates);
      this.jobs.setStep(jobId, step, { status: 'done', detail: 'All install gates passed.' });

      // ---- 2. fetch (cache hit — preflight just downloaded it) + payload validation ----
      step = 'fetch';
      this.jobs.setStep(jobId, step, { status: 'running' });
      const bundle = await this.bundleService.fetchBundle(entry.bundleUrl, entry.sha256);
      const manifest = bundle.manifest;
      const ruleSets = this.parseAndValidateRuleSets(bundle);
      this.jobs.setStep(jobId, step, {
        status: 'done',
        detail: `Bundle ${bundle.sha256.slice(0, 12)} verified; ${ruleSets.length} rule set payload(s) validated.`,
      });

      const appHost = projectGates.appHost ?? this.computeAppHost(manifest);
      const created: CreatedResources = {
        ruleSetIds: [],
        schemaIdsCreated: [],
        scheduleIds: [],
      };

      // ---- 3. project resolution + the durable installing row ----
      step = 'sync-rules';
      this.jobs.setStep(jobId, step, { status: 'running' });
      const project = await this.resolveProject(target, userId, created);
      this.jobs.setProjectId(jobId, project.id);
      const row = await this.loadOrCreateRow(manifest, project.id, bundle.sha256, userId);
      rowId = row.id;
      // Carry forward what a previous (failed) attempt already created.
      this.mergeCreated(created, row.createdResources);

      progress = {
        created,
        ruleSetIds: [...(row.ruleSetIds ?? [])],
        schemaIds: [...(row.schemaIds ?? [])],
        deploymentId: row.deploymentId ?? undefined,
        domainId: row.domainId ?? undefined,
      };

      // ---- 4. sync-rules ----
      const { missingSecrets, warnings } = await this.syncRuleSets(
        ruleSets,
        manifest,
        project.id,
        userId,
        { prune: false },
        progress,
      );
      await this.persistProgress(row.id, progress);
      this.jobs.setStep(jobId, step, {
        status: 'done',
        detail: this.syncDetail(ruleSets.length, missingSecrets, warnings),
      });

      // ---- 5. deploy ----
      step = 'deploy';
      this.jobs.setStep(jobId, step, { status: 'running' });
      const deployment = await this.deployBundle(bundle, manifest, ruleSets, project, userId);
      created.aliasName = manifest.install.alias;
      created.deploymentId = deployment.deploymentId;
      progress.deploymentId = deployment.deploymentId;
      await this.persistProgress(row.id, progress);
      this.jobs.setStep(jobId, step, {
        status: 'done',
        detail: `Deployed ${deployment.fileCount} file(s) to alias "${manifest.install.alias}".`,
      });

      // ---- 6. domain ----
      step = 'domain';
      const domainOutcome = await this.applyDomainStep(jobId, manifest, row, project.id, appHost, userId);
      if (domainOutcome.domainId) {
        created.domainId = domainOutcome.domainId;
        progress.domainId = domainOutcome.domainId;
      }
      await this.persistProgress(row.id, progress);

      // ---- 7. certificate (never fails the install) ----
      step = 'certificate';
      const certManualSteps = await this.applyCertificateStep(
        jobId,
        appHost,
        domainOutcome.sslDowngraded,
      );

      // ---- 8. schedules ----
      step = 'schedules';
      await this.applyScheduleStep(jobId, manifest, project.id, userId, created);
      await this.persistProgress(row.id, progress);

      // ---- 9. record ----
      step = 'record';
      this.jobs.setStep(jobId, step, { status: 'running' });
      const manualSteps = [...this.applicableManualSteps(manifest), ...certManualSteps];
      const appUrl =
        appHost && created.domainId ? `https://${appHost}` : deployment.urls?.default;

      await db
        .update(installedApps)
        .set({
          name: manifest.name,
          version: manifest.version,
          alias: manifest.install.alias,
          bundleSha256: bundle.sha256,
          manifest,
          ruleSetIds: progress.ruleSetIds,
          schemaIds: progress.schemaIds,
          deploymentId: deployment.deploymentId,
          domainId: created.domainId ?? null,
          createdResources: created,
          status: 'installed',
          updatedAt: new Date(),
        })
        .where(eq(installedApps.id, row.id));

      this.jobs.setStep(jobId, step, { status: 'done', detail: 'Install recorded.' });
      this.jobs.finish(jobId, 'succeeded', { installedAppId: row.id, manualSteps, appUrl });
      this.logger.log(`Installed app ${manifest.id} v${manifest.version} into project ${project.id}`);
    } catch (error) {
      await this.failJob(jobId, step, rowId, error, progress);
    }
  }

  // ==================== update ====================

  private async runUpdate(
    jobId: string,
    installed: InstalledApp,
    entry: AppRegistryEntry,
    userId: string,
    opts: { prune: boolean },
  ): Promise<void> {
    let step: InstallStepId = 'preflight';
    let progress: InstallProgress | undefined;
    // Stays undefined until the gates pass, so a refused update leaves the
    // healthy `installed_apps` row exactly as it was — a gate failure writes
    // nothing, and must not restamp a working install as `failed`.
    let rowId: string | undefined;

    try {
      // ---- 1. preflight: the instance may no longer satisfy this version's
      // requirements, even though the previous version installed fine ----
      this.jobs.setStep(jobId, step, { status: 'running' });
      this.assertGatesPass(await this.preflightService.instanceGates(entry.requires), 'Update');
      this.jobs.setStep(jobId, step, { status: 'done', detail: 'All instance gates passed.' });

      step = 'fetch';
      this.jobs.setStep(jobId, step, { status: 'running' });
      const bundle = await this.bundleService.fetchBundle(entry.bundleUrl, entry.sha256);
      const manifest = bundle.manifest;
      const ruleSets = this.parseAndValidateRuleSets(bundle);
      this.jobs.setStep(jobId, step, {
        status: 'done',
        detail: `Bundle ${bundle.sha256.slice(0, 12)} verified; ${ruleSets.length} rule set payload(s) validated.`,
      });

      const project = await this.projectsService.getProjectById(installed.projectId);
      const created: CreatedResources = {
        ruleSetIds: [],
        schemaIdsCreated: [],
        scheduleIds: [],
      };
      this.mergeCreated(created, installed.createdResources);

      step = 'sync-rules';
      this.jobs.setStep(jobId, step, { status: 'running' });
      // From here on the run can write; a failure past this point must carry
      // the accumulated progress onto the row (see failJob).
      rowId = installed.id;
      progress = {
        created,
        ruleSetIds: [...(installed.ruleSetIds ?? [])],
        schemaIds: [...(installed.schemaIds ?? [])],
        deploymentId: installed.deploymentId ?? undefined,
        domainId: installed.domainId ?? undefined,
      };
      const { missingSecrets, warnings } = await this.syncRuleSets(
        ruleSets,
        manifest,
        project.id,
        userId,
        { prune: opts.prune },
        progress,
      );
      await this.persistProgress(installed.id, progress);
      this.jobs.setStep(jobId, step, {
        status: 'done',
        detail: this.syncDetail(ruleSets.length, missingSecrets, warnings, opts.prune),
      });

      // Same alias: the alias's deployment history IS the rollback mechanism.
      step = 'deploy';
      this.jobs.setStep(jobId, step, { status: 'running' });
      const deployment = await this.deployBundle(bundle, manifest, ruleSets, project, userId);
      created.aliasName = manifest.install.alias;
      created.deploymentId = deployment.deploymentId;
      progress.deploymentId = deployment.deploymentId;
      await this.persistProgress(installed.id, progress);
      this.jobs.setStep(jobId, step, {
        status: 'done',
        detail: `Deployed ${deployment.fileCount} file(s) to alias "${manifest.install.alias}".`,
      });

      step = 'record';
      this.jobs.setStep(jobId, step, { status: 'running' });
      await db
        .update(installedApps)
        .set({
          name: manifest.name,
          version: manifest.version,
          bundleSha256: bundle.sha256,
          manifest,
          ruleSetIds: progress.ruleSetIds,
          schemaIds: progress.schemaIds,
          deploymentId: deployment.deploymentId,
          createdResources: created,
          status: 'installed',
          updatedAt: new Date(),
        })
        .where(eq(installedApps.id, installed.id));

      const manualSteps = this.applicableManualSteps(manifest);
      const appUrl = installed.domainId
        ? `https://${this.computeAppHost(manifest) ?? ''}`
        : deployment.urls?.default;
      this.jobs.setStep(jobId, step, { status: 'done', detail: 'Update recorded.' });
      this.jobs.finish(jobId, 'succeeded', {
        installedAppId: installed.id,
        manualSteps,
        appUrl,
      });
    } catch (error) {
      await this.failJob(jobId, step, rowId, error, progress);
    }
  }

  // ==================== undo / uninstall ====================

  /**
   * Deletes ONLY this install's own created objects, in reverse creation
   * order, then drops the `installed_apps` row. Never touches a reused schema,
   * an adopted rule set, or a pre-existing domain.
   *
   * The row is only dropped when every attempted deletion succeeded. If any
   * failed, the row is KEPT (`status: 'failed'`) rather than silently leaving
   * a stranded, untracked resource with nothing left to retry it from — the
   * caller sees which labels failed via `failures` and can call `undo` again
   * (each `tryRun` treats an already-gone resource as success, so a retry
   * only re-attempts what's still actually live).
   */
  async undo(installedAppId: string, userId: string): Promise<{ removed: string[]; failures?: string[] }> {
    const row = await this.requireRow(installedAppId);
    const { removed, failures } = await this.deleteCreatedResources(row, userId, { includeSchemas: true });

    if (failures.length > 0) {
      await db
        .update(installedApps)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(eq(installedApps.id, row.id));

      this.logger.warn(
        `Undo of app install ${row.appId} (${row.id}) left ${failures.length} object(s) undeleted ` +
          `(${failures.join(', ')}); row kept for retry.`,
      );
      return { removed, failures };
    }

    await db.delete(installedApps).where(eq(installedApps.id, row.id));

    const job = this.jobs.findByInstalledApp(row.id);
    if (job) this.jobs.finish(job.id, 'undone');

    this.logger.log(`Undid app install ${row.appId} (${row.id}): removed ${removed.join(', ') || 'nothing'}`);
    return { removed };
  }

  /**
   * Uninstall treats the app's content as the USER's, not the installer's:
   * it removes the app's own infrastructure (rule sets, alias, domain,
   * deployment, schedules) but keeps every data table and stored object by
   * default. `deleteData: true` additionally drops the tables this install
   * itself created — a table the sync merely REUSED is never dropped, no
   * matter what the flag says.
   *
   * One deliberate divergence from {@link undo}: rule-set removal here walks
   * `row.ruleSetIds` (every rule set this app's rule-set files sync, whether
   * created or adopted), not `createdResources.ruleSetIds`. `undo` unwinds a
   * failed/in-progress install and must never touch a set it didn't create;
   * a full uninstall is the user tearing the app down, and its rule sets
   * (named after the app, not general-purpose) go with it.
   *
   * Same row-retention rule as {@link undo}: the `installed_apps` row is only
   * dropped once every attempted deletion (infrastructure AND, when
   * `deleteData` is true, data tables) succeeded. A partial failure keeps the
   * row (`status: 'failed'`) and reports which `kind:id` labels failed via
   * `UninstallSummary.failures`, so a repeat call has something to retry from
   * instead of orphaning whatever didn't get cleaned up.
   */
  async uninstall(
    installedAppId: string,
    userId: string,
    opts: { deleteData: boolean },
  ): Promise<UninstallSummary> {
    const row = await this.requireRow(installedAppId);
    const project = await this.projectsService.getProjectById(row.projectId);

    const { dataTables, failures: dataTableFailures } = await this.resolveUninstallDataTables(
      row,
      opts.deleteData,
      userId,
    );
    const { removed, failures: lifecycleFailures } = await this.removeLifecycleResources(
      row,
      userId,
      project,
      row.ruleSetIds ?? [],
    );
    const failures = [...dataTableFailures, ...lifecycleFailures];
    const note = `Stored objects under project ${project.owner}/${project.name} remain; delete the project for full cleanup.`;

    if (failures.length > 0) {
      await db
        .update(installedApps)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(eq(installedApps.id, row.id));

      this.logger.warn(
        `Uninstall of app ${row.appId} (${row.id}) left ${failures.length} object(s) undeleted ` +
          `(${failures.join(', ')}); row kept for retry.`,
      );
      return { removed, dataTables, note, failures };
    }

    await db.delete(installedApps).where(eq(installedApps.id, row.id));

    this.logger.log(
      `Uninstalled app ${row.appId} (${row.id}); data ${opts.deleteData ? 'deleted' : 'kept'}`,
    );

    return { removed, dataTables, note };
  }

  /**
   * Powers the uninstall dialog's real counts ("this deletes 412 records
   * across 3 tables") before the user commits to `deleteData: true`.
   */
  async uninstallPreview(installedAppId: string): Promise<UninstallPreview> {
    const row = await this.requireRow(installedAppId);
    const createdSchemaIds = new Set(row.createdResources?.schemaIdsCreated ?? []);

    const dataTables: UninstallPreview['dataTables'] = [];
    for (const id of row.schemaIds ?? []) {
      const withCount = await this.schemasService.getByIdWithCount(id, null);
      dataTables.push({
        name: withCount?.name ?? id,
        recordCount: withCount?.recordCount ?? 0,
        createdByInstall: createdSchemaIds.has(id),
      });
    }

    return { dataTables };
  }

  /**
   * Splits `row.schemaIds` into kept/deleted for the uninstall summary. A
   * table only ever moves to `deleted` when BOTH `deleteData` is true AND
   * this install created it — reused tables are unconditionally kept.
   * Record counts are fetched via `getByIdWithCount` before the delete call,
   * so a partial failure still reports what would have been removed.
   */
  private async resolveUninstallDataTables(
    row: InstalledApp,
    deleteData: boolean,
    userId: string,
  ): Promise<{ dataTables: UninstallSummary['dataTables']; failures: string[] }> {
    const createdSchemaIds = new Set(row.createdResources?.schemaIdsCreated ?? []);
    const kept: string[] = [];
    const deleted: string[] = [];
    const deletedRecordCounts: Record<string, number> = {};
    const failures: string[] = [];

    for (const id of row.schemaIds ?? []) {
      const withCount = await this.schemasService.getByIdWithCount(id, null);
      const name = withCount?.name ?? id;

      if (!deleteData || !createdSchemaIds.has(id)) {
        kept.push(name);
        continue;
      }

      deletedRecordCounts[name] = withCount?.recordCount ?? 0;
      const ok = await this.tryRun(`schema:${id}`, () =>
        this.schemasService.delete(id, userId, 'admin', null),
      );
      if (ok) {
        deleted.push(name);
      } else {
        kept.push(name);
        delete deletedRecordCounts[name];
        failures.push(`schema:${id}`);
      }
    }

    return { dataTables: { kept, deleted, deletedRecordCounts }, failures };
  }

  /**
   * Removes an installed app's own infrastructure — schedules, domain,
   * alias, deployment, then rule sets — reporting a count/boolean per class
   * for {@link UninstallSummary}. `ruleSetIds` is caller-supplied (see
   * {@link uninstall}'s doc comment on why it differs from `undo`).
   */
  private async removeLifecycleResources(
    row: InstalledApp,
    userId: string,
    project: ProjectRef,
    ruleSetIds: string[],
  ): Promise<{ removed: UninstallSummary['removed']; failures: string[] }> {
    const created: CreatedResources = row.createdResources ?? {};
    const failures: string[] = [];

    let schedulesRemoved = 0;
    for (const scheduleId of created.scheduleIds ?? []) {
      const ok = await this.tryRun(`schedule:${scheduleId}`, () =>
        this.schedulesService.deleteSchedule(scheduleId, userId, 'admin', null),
      );
      if (ok) schedulesRemoved++;
      else failures.push(`schedule:${scheduleId}`);
    }

    let domainRemoved = false;
    if (created.domainId) {
      domainRemoved = await this.tryRun(`domain:${created.domainId}`, () =>
        this.domainsService.remove(created.domainId!, userId, undefined, null),
      );
      if (!domainRemoved) failures.push(`domain:${created.domainId}`);
    }

    let aliasRemoved = false;
    if (created.aliasName) {
      aliasRemoved = await this.tryRun(`alias:${created.aliasName}`, () =>
        this.deploymentsService.deleteAlias(
          `${project.owner}/${project.name}`,
          created.aliasName!,
          userId,
          'admin',
        ),
      );
      if (!aliasRemoved) failures.push(`alias:${created.aliasName}`);
    }

    let deploymentRemoved = false;
    if (created.deploymentId) {
      deploymentRemoved = await this.tryRun(`deployment:${created.deploymentId}`, () =>
        this.deploymentsService.deleteDeployment(created.deploymentId!, userId, 'admin'),
      );
      if (!deploymentRemoved) failures.push(`deployment:${created.deploymentId}`);
    }

    let ruleSetsRemoved = 0;
    for (const ruleSetId of ruleSetIds) {
      const ok = await this.tryRun(`ruleSet:${ruleSetId}`, () =>
        this.ruleSetsService.delete(ruleSetId, userId, 'admin', null),
      );
      if (ok) ruleSetsRemoved++;
      else failures.push(`ruleSet:${ruleSetId}`);
    }

    return {
      removed: {
        ruleSets: ruleSetsRemoved,
        alias: aliasRemoved,
        domain: domainRemoved,
        deployment: deploymentRemoved,
        schedules: schedulesRemoved,
      },
      failures,
    };
  }

  private async deleteCreatedResources(
    row: InstalledApp,
    userId: string,
    opts: { includeSchemas: boolean; kept?: string[] },
  ): Promise<{ removed: string[]; failures: string[] }> {
    const created: CreatedResources = row.createdResources ?? {};
    const removed: string[] = [];
    const failures: string[] = [];

    for (const scheduleId of created.scheduleIds ?? []) {
      await this.tryDelete(removed, failures, `schedule:${scheduleId}`, () =>
        this.schedulesService.deleteSchedule(scheduleId, userId, 'admin', null),
      );
    }

    if (created.domainId) {
      await this.tryDelete(removed, failures, `domain:${created.domainId}`, () =>
        this.domainsService.remove(created.domainId!, userId, undefined, null),
      );
    }

    if (created.aliasName) {
      const project = await this.projectsService.getProjectById(row.projectId);
      await this.tryDelete(removed, failures, `alias:${created.aliasName}`, () =>
        this.deploymentsService.deleteAlias(
          `${project.owner}/${project.name}`,
          created.aliasName!,
          userId,
          'admin',
        ),
      );
    }

    if (created.deploymentId) {
      await this.tryDelete(removed, failures, `deployment:${created.deploymentId}`, () =>
        this.deploymentsService.deleteDeployment(created.deploymentId!, userId, 'admin'),
      );
    }

    for (const ruleSetId of created.ruleSetIds ?? []) {
      await this.tryDelete(removed, failures, `ruleSet:${ruleSetId}`, () =>
        this.ruleSetsService.delete(ruleSetId, userId, 'admin', null),
      );
    }

    for (const schemaId of created.schemaIdsCreated ?? []) {
      if (!opts.includeSchemas) {
        opts.kept?.push(`schema:${schemaId}`);
        continue;
      }
      await this.tryDelete(removed, failures, `schema:${schemaId}`, () =>
        this.schemasService.delete(schemaId, userId, 'admin', null),
      );
    }

    if (created.projectCreated) {
      if (await this.projectIsEmpty(row.projectId)) {
        await this.tryDelete(removed, failures, `project:${row.projectId}`, () =>
          this.projectsService.deleteProject(row.projectId),
        );
      } else {
        opts.kept?.push(`project:${row.projectId}`);
      }
    }

    return { removed, failures };
  }

  /** A project we created is only removable if this app was its only content. */
  private async projectIsEmpty(projectId: string): Promise<boolean> {
    const aliases = await db
      .select({ id: deploymentAliases.id })
      .from(deploymentAliases)
      .where(eq(deploymentAliases.projectId, projectId));
    if (aliases.length > 0) return false;

    const sets = await db
      .select({ id: proxyRuleSets.id })
      .from(proxyRuleSets)
      .where(eq(proxyRuleSets.projectId, projectId));
    return sets.length === 0;
  }

  private async tryDelete(
    removed: string[],
    failures: string[],
    label: string,
    run: () => Promise<unknown>,
  ): Promise<void> {
    if (await this.tryRun(label, run)) {
      removed.push(label);
    } else {
      failures.push(label);
    }
  }

  /**
   * Runs `run`, swallowing (and logging) a failure so it can't strand the
   * rest of a cleanup — EXCEPT a `NotFoundException`, which means the
   * resource is already gone. That's the desired end state, not a failure:
   * without this, a retry over a row kept alive by a PRIOR partial failure
   * would re-throw on every already-deleted resource and could never
   * complete, since every delete call here (`ProxyRuleSetsService.delete`,
   * `PipelineSchemasService.delete`, `DomainsService.remove`,
   * `DeploymentsService.deleteAlias`/`deleteDeployment`,
   * `PipelineSchedulesService.deleteSchedule`) throws `NotFoundException` for
   * a missing id.
   */
  private async tryRun(label: string, run: () => Promise<unknown>): Promise<boolean> {
    try {
      await run();
      return true;
    } catch (error) {
      if (error instanceof NotFoundException) {
        this.logger.log(`${label} was already removed.`);
        return true;
      }
      this.logger.warn(`Failed to remove ${label}: ${this.messageOf(error)}`);
      return false;
    }
  }

  // ==================== steps ====================

  private async syncRuleSets(
    ruleSets: ParsedRuleSet[],
    manifest: AppManifest,
    projectId: string,
    userId: string,
    options: { prune: boolean },
    acc: InstallProgress,
  ): Promise<{ missingSecrets: string[]; warnings: string[] }> {
    const missingSecrets: string[] = [];
    const warnings: string[] = [];

    for (const ruleSet of ruleSets) {
      const response = await this.ruleSetsService.syncRuleSet(
        projectId,
        {
          ...ruleSet.dto,
          options: { dryRun: false, prune: options.prune },
          source: { repo: manifest.eject?.repo, path: ruleSet.file },
        } as SyncProxyRuleSetDto,
        userId,
        'admin',
        null,
      );

      if (response.ruleSetId) {
        pushUnique(acc.ruleSetIds, response.ruleSetId);
        // Only a set we CREATED is ours to delete on undo.
        if (response.setCreated) pushUnique(acc.created.ruleSetIds!, response.ruleSetId);
      }

      for (const resolution of response.schemaResolutions ?? []) {
        if (!resolution.targetSchemaId) continue;
        pushUnique(acc.schemaIds, resolution.targetSchemaId);
        if (resolution.action === 'create') {
          pushUnique(acc.created.schemaIdsCreated!, resolution.targetSchemaId);
        }
      }

      missingSecrets.push(...(response.missingSecrets ?? []));
      warnings.push(...(response.warnings ?? []));
    }

    return { missingSecrets, warnings };
  }

  private async deployBundle(
    bundle: LoadedBundle,
    manifest: AppManifest,
    ruleSets: ParsedRuleSet[],
    project: ProjectRef,
    userId: string,
  ) {
    const zipped = this.buildDistZip(bundle, manifest);
    const alias = manifest.install.alias;
    const attachNames = ruleSets.filter((r) => r.attach).map((r) => r.name);

    const response = await this.deploymentsService.createDeploymentFromZip(
      {
        buffer: zipped,
        originalname: `${manifest.id}-bundle.zip`,
        mimetype: 'application/zip',
      } as Express.Multer.File,
      {
        repository: `${project.owner}/${project.name}`,
        commitSha: bundle.sha256.slice(0, 40),
        branch: 'app-catalog',
        alias,
        description: `App install: ${manifest.name} v${manifest.version}`,
        basePath: manifest.install.deployment.basePath,
        proxyRuleSetNames: attachNames,
        source: 'manual',
      },
      userId,
      'admin',
    );

    // An explicit-alias failure is swallowed upstream (deployments.service.ts:
    // "Alias creation failure is non-critical"), so absence here is the ONLY
    // signal that the app's URL would 404. Treat it as a step failure.
    if (!response.aliases?.includes(alias)) {
      throw new Error(
        `Deployment ${response.deploymentId} did not receive the "${alias}" alias — the app would not be reachable.`,
      );
    }

    return response;
  }

  private async applyDomainStep(
    jobId: string,
    manifest: AppManifest,
    row: InstalledApp,
    projectId: string,
    appHost: string | null,
    userId: string,
  ): Promise<{ domainId?: string; sslDowngraded: boolean }> {
    const domain = manifest.install.domain;
    if (!domain || !appHost) {
      this.jobs.setStep(jobId, 'domain', {
        status: 'skipped',
        detail: 'This app declares no domain; it is served from its alias URL.',
      });
      return { sslDowngraded: false };
    }

    this.jobs.setStep(jobId, 'domain', { status: 'running' });

    // Idempotent re-run: this app already owns the mapping.
    const ownDomainId = row.createdResources?.domainId ?? row.domainId ?? undefined;
    if (ownDomainId) {
      this.jobs.setStep(jobId, 'domain', {
        status: 'done',
        detail: `${appHost} is already mapped by this install.`,
      });
      return { domainId: ownDomainId, sslDowngraded: false };
    }

    const createdDomain = await this.domainsService.create(
      {
        projectId,
        alias: manifest.install.alias,
        path: manifest.install.deployment.basePath,
        domain: appHost,
        domainType: 'subdomain',
        sslEnabled: true,
        isPublic: domain.isPublic,
        isSpa: domain.isSpa,
      },
      userId,
      undefined,
      null,
    );

    // A subdomain's sslEnabled is silently downgraded when no wildcard cert
    // exists — read it back rather than assuming what we asked for.
    const sslDowngraded = createdDomain?.sslEnabled === false;
    this.jobs.setStep(jobId, 'domain', { status: 'done', detail: `${appHost} mapped to this app.` });
    return { domainId: createdDomain.id, sslDowngraded };
  }

  private async applyCertificateStep(
    jobId: string,
    appHost: string | null,
    sslDowngraded: boolean,
  ): Promise<AppManualStep[]> {
    if (!appHost) {
      this.jobs.setStep(jobId, 'certificate', {
        status: 'skipped',
        detail: 'No app domain, so no certificate is needed.',
      });
      return [];
    }

    try {
      const plan = await this.certStepService.plan(appHost);
      const result = await this.certStepService.execute(plan, appHost);
      const detail = sslDowngraded
        ? `${result.detail} Note: the domain row came back with SSL disabled (no wildcard certificate covers ` +
          `${appHost} yet), so HTTPS may not work until a certificate is applied.`
        : result.detail;
      this.jobs.setStep(jobId, 'certificate', { status: result.status, detail });
      return result.manualStep ? [result.manualStep] : [];
    } catch (error) {
      // A cert problem must never fail an install — the app stays reachable
      // over the existing certificate or plain HTTP meanwhile.
      const message = this.messageOf(error);
      this.logger.warn(`Certificate step for ${appHost} failed: ${message}`);
      this.jobs.setStep(jobId, 'certificate', {
        status: 'skipped',
        detail: `Certificate step skipped: ${message}. Verify SSL for ${appHost} manually.`,
      });
      return [];
    }
  }

  private async applyScheduleStep(
    jobId: string,
    manifest: AppManifest,
    projectId: string,
    userId: string,
    created: CreatedResources,
  ): Promise<void> {
    const wanted = manifest.install.schedules ?? [];
    if (wanted.length === 0) {
      this.jobs.setStep(jobId, 'schedules', {
        status: 'skipped',
        detail: 'This app ships no scheduled pipelines.',
      });
      return;
    }

    this.jobs.setStep(jobId, 'schedules', { status: 'running' });
    const rules = await this.schedulesService.listPipelineRules(projectId, userId, 'admin', null);
    const existing = await this.schedulesService.listSchedules(projectId, userId, 'admin', null);

    let createdCount = 0;
    for (const schedule of wanted) {
      // Schedules have no name-uniqueness constraint, so idempotency is the
      // installer's own job.
      if (existing.some((e) => e.name === schedule.name)) continue;

      const wantedMethod = schedule.targetRuleMethod ?? null;
      const rule = rules.find(
        (r) => r.pathPattern === schedule.targetRulePath && (r.method ?? null) === wantedMethod,
      );
      if (!rule) {
        throw new Error(
          `No pipeline rule matching ${wantedMethod ?? 'ANY'} ${schedule.targetRulePath} was found ` +
            `for schedule "${schedule.name}".`,
        );
      }

      const row = await this.schedulesService.createSchedule(
        projectId,
        {
          name: schedule.name,
          targetProxyRuleId: rule.id,
          cronExpression: schedule.cronExpression,
          timezone: schedule.timezone ?? 'UTC',
        },
        userId,
        'admin',
        null,
      );
      pushUnique(created.scheduleIds!, row.id);
      createdCount++;
    }

    this.jobs.setStep(jobId, 'schedules', {
      status: 'done',
      detail: `${createdCount} schedule(s) created, ${wanted.length - createdCount} already present.`,
    });
  }

  // ==================== helpers ====================

  private assertGatesPass(gates: GateResult[], kind: 'Install' | 'Update' = 'Install'): void {
    const failures = gates.filter((gate) => gate.status === 'fail');
    if (failures.length === 0) return;
    throw new BadRequestException(
      `${kind} blocked by preflight: ${failures.map((f) => f.message).join(' ')}`,
    );
  }

  private toPreflightTarget(
    target: InstallTarget,
  ): { projectId: string } | { newProject: { owner: string; name: string } } {
    if (target.projectId) return { projectId: target.projectId };
    if (target.newProject) return { newProject: target.newProject };
    throw new BadRequestException('An install target requires either projectId or newProject');
  }

  private async resolveProject(
    target: InstallTarget,
    userId: string,
    created: CreatedResources,
  ): Promise<ProjectRef> {
    if (target.projectId) {
      created.projectCreated = false;
      const project = await this.projectsService.getProjectById(target.projectId);
      return { id: project.id, owner: project.owner, name: project.name };
    }
    if (!target.newProject) {
      throw new BadRequestException('An install target requires either projectId or newProject');
    }

    const { owner, name } = target.newProject;
    // Check BEFORE creating — findOrCreateProject is idempotent, so afterwards
    // we could no longer tell whether the project was ours.
    //
    // An existing project is a REFUSAL, not an adoption: every project-scoped
    // collision gate (rule-set names, the app's alias, the per-project install
    // row) is skipped for a `newProject` target, and findOrCreateProject would
    // quietly hand us someone else's project with its own alias — which would
    // then land in `createdResources.aliasName` and be deleted by a later
    // undo. Preflight already fails this (`name-collision`); repeating it here
    // is defense in depth for any caller that reaches the installer directly.
    // Retrying a failed newProject install is unaffected in substance: the
    // project now exists, so the operator picks it from the picker and the
    // full set of gates runs, recognising this app's own objects as its own.
    if (await this.projectsService.projectExists(owner, name)) {
      throw new BadRequestException(
        `A project named "${owner}/${name}" already exists — select it from the project picker instead of ` +
          'creating it, so the install can check its existing rule sets, aliases and data tables for collisions.',
      );
    }
    const project = await this.projectsService.findOrCreateProject(owner, name, userId);
    created.projectCreated = true;
    return { id: project.id, owner: project.owner, name: project.name };
  }

  /**
   * The `installed_apps` row goes in with `status: 'installing'` BEFORE any
   * project-scoped write, so a crash mid-install still leaves an undoable
   * record. A row from a previous failed attempt is reused (resume), never
   * duplicated — `(app_id, project_id)` is unique anyway.
   */
  private async loadOrCreateRow(
    manifest: AppManifest,
    projectId: string,
    bundleSha256: string,
    userId: string,
  ): Promise<InstalledApp> {
    const [existing] = await db
      .select()
      .from(installedApps)
      .where(and(eq(installedApps.appId, manifest.id), eq(installedApps.projectId, projectId)))
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(installedApps)
        .set({ status: 'installing', manifest, bundleSha256, updatedAt: new Date() })
        .where(eq(installedApps.id, existing.id))
        .returning();
      return updated ?? existing;
    }

    const [inserted] = await db
      .insert(installedApps)
      .values({
        appId: manifest.id,
        name: manifest.name,
        version: manifest.version,
        projectId,
        alias: manifest.install.alias,
        bundleSha256,
        manifest,
        status: 'installing',
        createdResources: {},
        installedBy: userId,
      })
      .returning();

    return inserted;
  }

  /**
   * Flushes accumulated progress to the row. Called after every step that
   * creates something, so a crash (or a later step's failure) still leaves
   * `createdResources` describing exactly what exists — which is what undo
   * replays and what preflight reads to recognise a re-run's own objects.
   */
  private async persistProgress(rowId: string, progress: InstallProgress): Promise<void> {
    await db
      .update(installedApps)
      .set({
        ruleSetIds: progress.ruleSetIds,
        schemaIds: progress.schemaIds,
        deploymentId: progress.deploymentId ?? null,
        domainId: progress.domainId ?? null,
        createdResources: progress.created,
        updatedAt: new Date(),
      })
      .where(eq(installedApps.id, rowId));
  }

  private async requireRow(installedAppId: string): Promise<InstalledApp> {
    const [row] = await db
      .select()
      .from(installedApps)
      .where(eq(installedApps.id, installedAppId))
      .limit(1);
    if (!row) throw new NotFoundException(`Installed app ${installedAppId} not found`);
    return row;
  }

  private mergeCreated(target: CreatedResources, source?: CreatedResources | null): void {
    if (!source) return;
    for (const id of source.ruleSetIds ?? []) pushUnique(target.ruleSetIds!, id);
    for (const id of source.schemaIdsCreated ?? []) pushUnique(target.schemaIdsCreated!, id);
    for (const id of source.scheduleIds ?? []) pushUnique(target.scheduleIds!, id);
    if (source.projectCreated !== undefined) target.projectCreated = source.projectCreated;
    if (source.aliasName) target.aliasName = source.aliasName;
    if (source.deploymentId) target.deploymentId = source.deploymentId;
    if (source.domainId) target.domainId = source.domainId;
  }

  /**
   * Runs every bundled rule-set payload through the REAL sync DTO pipeline
   * (`plainToInstance` + `validateSync`) so a direct service call gets the
   * same SSRF/shape validation an HTTP caller would (`IsValidSyncTargetUrl`
   * and friends). Anything invalid aborts the install before a single write.
   */
  private parseAndValidateRuleSets(bundle: LoadedBundle): ParsedRuleSet[] {
    return bundle.manifest.install.ruleSets.map((entry) => {
      const bytes = bundle.files[entry.file];
      if (!bytes) {
        throw new BadRequestException(`Bundle is missing declared rule set file: ${entry.file}`);
      }

      let json: unknown;
      try {
        json = JSON.parse(new TextDecoder().decode(bytes));
      } catch (error) {
        throw new BadRequestException(`${entry.file} is not valid JSON: ${this.messageOf(error)}`);
      }

      const dto = plainToInstance(SyncProxyRuleSetDto, json);
      // forbidNonWhitelisted mirrors main.ts's global ValidationPipe. Without
      // it, `whitelist` would silently DELETE undecorated keys (a typo'd or
      // newer-schema `pipelineConfig` key just vanishes) and the mutated
      // object is what gets synced — installing a pipeline that is not the one
      // the bundle shipped. The same payload 400s over HTTP; a stale bundle
      // must abort here too, not install quietly altered.
      const errors = validateSync(dto as object, {
        whitelist: true,
        forbidNonWhitelisted: true,
        forbidUnknownValues: false,
      });
      if (errors.length > 0) {
        throw new BadRequestException(
          `${entry.file} failed rule-set validation: ${flattenValidationErrors(errors).join('; ')}`,
        );
      }

      return {
        file: entry.file,
        name: dto.ruleSet.name,
        attach: entry.attachToAlias !== false,
        dto,
      };
    });
  }

  /**
   * The deployment carries only the manifest's `deployment.path` subtree,
   * re-keyed under `basePath` (e.g. `dist/index.html` →
   * `apps/handoff/dist/index.html`) so the alias's basePath resolves.
   */
  private buildDistZip(bundle: LoadedBundle, manifest: AppManifest): Buffer {
    const prefix = `${manifest.install.deployment.path.replace(/\/+$/, '')}/`;
    const base = manifest.install.deployment.basePath.replace(/^\/+/, '').replace(/\/+$/, '');

    const entries: Record<string, Uint8Array> = {};
    for (const [entryPath, bytes] of Object.entries(bundle.files)) {
      if (!entryPath.startsWith(prefix)) continue;
      const rest = entryPath.slice(prefix.length);
      if (!rest) continue;
      entries[base ? `${base}/${rest}` : rest] = bytes;
    }

    if (Object.keys(entries).length === 0) {
      throw new Error(`Bundle has no files under ${manifest.install.deployment.path}/ to deploy`);
    }

    return Buffer.from(zipSync(entries));
  }

  private applicableManualSteps(manifest: AppManifest): AppManualStep[] {
    const ctx = this.instanceContext();
    return (manifest.install.manualSteps ?? []).filter((step) => manualStepApplies(step, ctx));
  }

  private instanceContext(): { bucketStorage: boolean; platformMode: boolean } {
    return {
      bucketStorage: resolveLocalAdapter(this.storageAdapter) === null,
      platformMode:
        this.configService.get<string>('PLATFORM_MODE') === 'true' ||
        process.env.PLATFORM_MODE === 'true',
    };
  }

  private computeAppHost(manifest: AppManifest): string | null {
    const subdomain = manifest.install.domain?.subdomain;
    if (!subdomain) return null;
    const primaryDomain = this.configService.get<string>('PRIMARY_DOMAIN') || '';
    return primaryDomain ? `${subdomain}.${primaryDomain}` : null;
  }

  private syncDetail(
    count: number,
    missingSecrets: string[],
    warnings: string[],
    prune?: boolean,
  ): string {
    const parts = [`Synced ${count} rule set(s)${prune ? ' with prune enabled' : ''}.`];
    if (missingSecrets.length > 0) {
      parts.push(`Missing project secrets: ${[...new Set(missingSecrets)].join(', ')}.`);
    }
    if (warnings.length > 0) parts.push(`Warnings: ${warnings.join('; ')}.`);
    return parts.join(' ');
  }

  private async failJob(
    jobId: string,
    step: InstallStepId,
    rowId: string | undefined,
    error: unknown,
    progress?: InstallProgress,
  ): Promise<void> {
    const message = this.messageOf(error);
    this.logger.error(`App install job ${jobId} failed at step "${step}": ${message}`);
    this.jobs.setStep(jobId, step, { status: 'failed', error: message });

    // Keep the row — it powers both undo and a resume-by-reinstall — and carry
    // the accumulated state with it. The step that threw may have created
    // things after the last persistProgress (e.g. schedules), and a row that
    // says "failed" with an empty createdResources is an unrecoverable orphan.
    if (rowId) {
      try {
        await db
          .update(installedApps)
          .set({
            status: 'failed',
            ...(progress
              ? {
                  ruleSetIds: progress.ruleSetIds,
                  schemaIds: progress.schemaIds,
                  deploymentId: progress.deploymentId ?? null,
                  domainId: progress.domainId ?? null,
                  createdResources: progress.created,
                }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(installedApps.id, rowId));
      } catch (updateError) {
        this.logger.error(`Could not mark install row ${rowId} failed: ${this.messageOf(updateError)}`);
      }
    }

    // Stamp installedAppId even on failure (when a row exists): the catalog's
    // undo-by-jobId route (Task 11) has no other way to find what to undo.
    this.jobs.finish(jobId, 'failed', { error: message, ...(rowId ? { installedAppId: rowId } : {}) });
  }

  private messageOf(error: unknown): string {
    if (error instanceof Error) return error.message;
    return typeof error === 'string' ? error : 'Unknown error';
  }
}

function pushUnique(list: string[], value: string): void {
  if (!list.includes(value)) list.push(value);
}

function flattenValidationErrors(errors: ValidationError[], path = ''): string[] {
  const messages: string[] = [];
  for (const error of errors) {
    const here = path ? `${path}.${error.property}` : error.property;
    if (error.constraints) {
      messages.push(`${here}: ${Object.values(error.constraints).join(', ')}`);
    }
    if (error.children?.length) {
      messages.push(...flattenValidationErrors(error.children, here));
    }
  }
  return messages;
}
