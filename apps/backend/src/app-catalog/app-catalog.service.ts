import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { installedApps, type InstalledApp, type InstalledAppStatus } from '../db/schema';
import { ProjectsService } from '../projects/projects.service';
import { IStorageAdapter, STORAGE_ADAPTER } from '../storage/storage.interface';
import { resolveLocalAdapter } from '../storage/local.adapter';
import { AppsRegistryService } from './apps-registry.service';
import { AppBundleService } from './app-bundle.service';
import {
  AppPreflightService,
  type GateResult,
  type SyncPlanSummary,
  type InstallTarget as PreflightInstallTarget,
} from './app-preflight.service';
import {
  AppInstallerService,
  type InstallTarget,
  type UninstallPreview,
  type UninstallSummary,
} from './app-installer.service';
import { AppInstallJobsService, type InstallJob } from './app-install-jobs.service';
import { compareSemver } from './ce-version.util';
import { manualStepApplies } from './app-manifest.util';
import type { AppManifest, AppManualStep, AppRegistryEntry } from './app-manifest.types';
import type { PreflightRequestDto } from './app-catalog.dtos';

export interface EjectPayload {
  repo: string;
  appPath: string;
  deployWorkflow: string;
  /** https://github.com/<repo>/fork */
  forkUrl: string;
  variables: Record<string, string>;
  secrets: string[];
  alias: string;
  note: string;
}

export interface CatalogEntry {
  id: string;
  name: string;
  summary?: string;
  iconUrl?: string;
  docsUrl?: string;
  sourceUrl?: string;
  /** Absent when the registry is unavailable, or this app isn't (or no longer) listed in it. */
  registryVersion?: string;
  /** Instance-level gates only (storage/CE-version/platform-config) — project gates are preflight-only. */
  gates: GateResult[];
  /** Every instance gate passed AND the app is present in the registry. */
  installable: boolean;
  installed?: {
    installedAppId: string;
    version: string;
    projectId: string;
    projectName: string;
    alias: string;
    appUrl?: string;
    status: InstalledAppStatus;
    updateAvailable: boolean;
    manualSteps: AppManualStep[];
    manualStepsAcked: string[];
  };
}

export interface CatalogListResult {
  data: CatalogEntry[];
  registryError?: string;
}

export interface PreflightResult {
  gates: GateResult[];
  syncPlans: SyncPlanSummary[];
  appHost: string | null;
  appUrl?: string;
}

/**
 * AppCatalogService — the admin HTTP surface's single entry point (Task 11 of
 * the app-catalog spec). Assembles the browsable catalog and fronts every
 * other app-catalog service (registry, bundle, preflight, installer, jobs)
 * behind one API the controller can call without knowing which of them owns
 * what. It does not reimplement any of their logic.
 */
@Injectable()
export class AppCatalogService {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly configService: ConfigService,
    private readonly registryService: AppsRegistryService,
    private readonly bundleService: AppBundleService,
    private readonly preflightService: AppPreflightService,
    private readonly installerService: AppInstallerService,
    private readonly jobsService: AppInstallJobsService,
    @Inject(STORAGE_ADAPTER) private readonly storageAdapter: IStorageAdapter,
  ) {}

  // ==================== catalog ====================

  /**
   * registry ∪ installed rows. A registry entry gets `instanceGates` for its
   * `requires`; an installed row whose app isn't (or no longer is) in the
   * registry still renders — from its own stored manifest, `registryVersion`
   * absent — rather than disappearing. A registry fetch failure degrades to
   * `registryError` at the top level; installed apps keep listing regardless.
   */
  async listCatalog(): Promise<CatalogListResult> {
    const registryResult = await this.registryService.getRegistry();
    const rows = await db.select().from(installedApps);

    const rowsByAppId = new Map<string, InstalledApp[]>();
    for (const row of rows) {
      const existing = rowsByAppId.get(row.appId);
      if (existing) existing.push(row);
      else rowsByAppId.set(row.appId, [row]);
    }

    const data: CatalogEntry[] = [];
    const seen = new Set<string>();

    if (registryResult.ok) {
      for (const entry of registryResult.registry.apps) {
        seen.add(entry.id);
        data.push(await this.buildRegistryEntry(entry, rowsByAppId.get(entry.id) ?? []));
      }
    }

    for (const [appId, appRows] of rowsByAppId) {
      if (seen.has(appId)) continue;
      data.push(await this.buildManifestOnlyEntry(appRows));
    }

    return registryResult.ok ? { data } : { data, registryError: registryResult.error };
  }

  /** Combined instance + project gates, for the install wizard's preview screen. */
  async preflight(appId: string, dto: PreflightRequestDto, userId: string): Promise<PreflightResult> {
    const entry = await this.requireRegistryEntry(appId);
    const target = this.toInstallTarget(dto);
    const bundle = await this.bundleService.fetchBundle(entry.bundleUrl, entry.sha256);

    const instanceGates = await this.preflightService.instanceGates(entry.requires);
    const { gates: projectGates, syncPlans, appHost } = await this.preflightService.projectGates(
      bundle,
      this.toPreflightTarget(target),
      userId,
      dto.subdomain,
    );

    return {
      gates: [...instanceGates, ...projectGates],
      syncPlans,
      appHost,
      appUrl: appHost ? `https://${appHost}` : undefined,
    };
  }

  async install(appId: string, dto: PreflightRequestDto, userId: string): Promise<{ jobId: string }> {
    const entry = await this.requireRegistryEntry(appId);
    const target = this.toInstallTarget(dto);
    return this.installerService.startInstall(entry, target, userId, dto.subdomain);
  }

  async updateInstalled(
    installedAppId: string,
    prune: boolean,
    userId: string,
  ): Promise<{ jobId: string }> {
    const row = await this.requireRow(installedAppId);
    const entry = await this.requireRegistryEntry(row.appId);
    return this.installerService.startUpdate(row, entry, userId, { prune });
  }

  getJob(jobId: string): InstallJob {
    const job = this.jobsService.get(jobId);
    if (!job) throw new NotFoundException(`Install job ${jobId} not found`);
    return job;
  }

  /**
   * Undo is keyed by jobId (the wizard only has the job it just started), not
   * by installedAppId — a job that failed before an `installed_apps` row ever
   * got created has nothing to undo.
   *
   * Undo is an INSTALL-only operation. `createdResources` is cumulative across
   * the row's whole lifetime, so undoing a failed *update* would tear down the
   * ORIGINAL install — rule sets, alias, domain, deployment and, because undo
   * passes `includeSchemas: true`, the data tables that install created, live
   * records and all. A transient fetch blip during an update must never be one
   * click away from that. An update has its own, non-destructive rollback: the
   * alias's deployment history still points at the previous version.
   */
  async undoJob(jobId: string, userId: string): Promise<{ removed: string[]; failures?: string[] }> {
    const job = this.getJob(jobId);
    if (job.kind === 'update') {
      throw new BadRequestException(
        'Undo is not available for an update — it would delete the original install, including its data ' +
          "tables. Nothing was removed: roll back by re-pointing the app's alias to the previous deployment " +
          'in its history, or run the update again once the cause is fixed.',
      );
    }
    if (!job.installedAppId) {
      return { removed: [] };
    }
    return this.installerService.undo(job.installedAppId, userId);
  }

  uninstallPreview(installedAppId: string): Promise<UninstallPreview> {
    return this.installerService.uninstallPreview(installedAppId);
  }

  uninstall(installedAppId: string, deleteData: boolean, userId: string): Promise<UninstallSummary> {
    return this.installerService.uninstall(installedAppId, userId, { deleteData });
  }

  /**
   * Renders the "eject to your own repo" panel straight from the stored
   * manifest — no registry refetch, so eject still works offline / after the
   * bundle has moved on. API-key minting stays a frontend concern (the
   * existing api-keys endpoints already cover it); this only tells the
   * caller which secret name the workflow expects.
   */
  async ejectPayload(installedAppId: string): Promise<EjectPayload> {
    const row = await this.requireRow(installedAppId);
    const manifest = row.manifest as AppManifest;
    if (!manifest.eject) {
      throw new NotFoundException(`App ${row.appId} does not declare an eject configuration`);
    }

    const project = await this.projectsService.getProjectById(row.projectId);

    return {
      repo: manifest.eject.repo,
      appPath: manifest.eject.appPath,
      deployWorkflow: manifest.eject.deployWorkflow,
      forkUrl: `https://github.com/${manifest.eject.repo}/fork`,
      variables: {
        BFFLESS_URL: this.adminOrigin(),
        BFFLESS_PROJECT: `${project.owner}/${project.name}`,
      },
      secrets: manifest.eject.secrets,
      alias: row.alias,
      note: "The workflow's first deploy lands on this same alias.",
    };
  }

  /** Idempotent: acking an already-acked step id is a no-op, not a duplicate entry. */
  async ackManualStep(installedAppId: string, stepId: string): Promise<string[]> {
    const row = await this.requireRow(installedAppId);
    const acked = new Set(row.manualStepsAcked ?? []);
    acked.add(stepId);
    const updated = [...acked];

    await db
      .update(installedApps)
      .set({ manualStepsAcked: updated, updatedAt: new Date() })
      .where(eq(installedApps.id, row.id));

    return updated;
  }

  // ==================== catalog assembly helpers ====================

  private async buildRegistryEntry(entry: AppRegistryEntry, rows: InstalledApp[]): Promise<CatalogEntry> {
    const gates = await this.preflightService.instanceGates(entry.requires);
    const base: CatalogEntry = {
      id: entry.id,
      name: entry.name ?? entry.id,
      summary: entry.summary,
      iconUrl: entry.iconUrl,
      docsUrl: entry.docsUrl,
      sourceUrl: entry.sourceUrl,
      registryVersion: entry.version,
      gates,
      installable: gates.every((gate) => gate.status !== 'fail'),
    };
    if (rows.length === 0) return base;

    const row = pickPrimaryRow(rows);
    return { ...base, installed: await this.buildInstalledSummary(row, entry.version) };
  }

  /** An installed app whose app id isn't (or no longer is) in the registry. */
  private async buildManifestOnlyEntry(rows: InstalledApp[]): Promise<CatalogEntry> {
    const row = pickPrimaryRow(rows);
    const manifest = row.manifest as AppManifest;
    const gates = await this.preflightService.instanceGates(manifest.requires);

    return {
      id: manifest.id,
      name: manifest.name,
      summary: manifest.summary,
      iconUrl: manifest.iconUrl,
      docsUrl: manifest.docsUrl,
      sourceUrl: manifest.sourceUrl,
      gates,
      installable: false, // no registry entry to install/reinstall from
      installed: await this.buildInstalledSummary(row, undefined),
    };
  }

  private async buildInstalledSummary(
    row: InstalledApp,
    registryVersion: string | undefined,
  ): Promise<NonNullable<CatalogEntry['installed']>> {
    const manifest = row.manifest as AppManifest;
    const project = await this.projectsService.getProjectById(row.projectId);
    const updateAvailable =
      registryVersion !== undefined && compareSemver(registryVersion, row.version) > 0;

    return {
      installedAppId: row.id,
      version: row.version,
      projectId: row.projectId,
      projectName: `${project.owner}/${project.name}`,
      alias: row.alias,
      appUrl: this.computeAppUrl(manifest, row),
      status: row.status,
      updateAvailable,
      manualSteps: this.applicableManualSteps(manifest),
      manualStepsAcked: row.manualStepsAcked ?? [],
    };
  }

  // ==================== helpers ====================

  private async requireRegistryEntry(appId: string): Promise<AppRegistryEntry> {
    const result = await this.registryService.getRegistry();
    if (!result.ok) {
      throw new BadRequestException(`App catalog registry is unavailable: ${result.error}`);
    }
    const entry = result.registry.apps.find((app) => app.id === appId);
    if (!entry) {
      throw new NotFoundException(`App "${appId}" was not found in the catalog registry`);
    }
    return entry;
  }

  private toInstallTarget(dto: PreflightRequestDto): InstallTarget {
    const hasProjectId = Boolean(dto.projectId);
    const hasNewProject = Boolean(dto.newProject);
    if (hasProjectId === hasNewProject) {
      throw new BadRequestException('Provide exactly one of projectId or newProject');
    }
    return hasProjectId ? { projectId: dto.projectId } : { newProject: dto.newProject };
  }

  private toPreflightTarget(target: InstallTarget): PreflightInstallTarget {
    if (target.projectId) return { projectId: target.projectId };
    if (target.newProject) return { newProject: target.newProject };
    throw new BadRequestException('Provide exactly one of projectId or newProject');
  }

  /**
   * `PUBLIC_ORIGIN` wins when set (an explicit override); otherwise the app's
   * eject target is always reachable at the admin host, so — unlike
   * `presign.util.ts`'s `explicitPublicOrigin` — falling back to
   * `PRIMARY_DOMAIN` here is correct rather than a guess.
   */
  private adminOrigin(): string {
    const explicit = this.configService.get<string>('PUBLIC_ORIGIN')?.trim();
    if (explicit) return explicit.replace(/\/+$/, '');
    const primaryDomain = this.configService.get<string>('PRIMARY_DOMAIN')?.trim() ?? '';
    return `https://admin.${primaryDomain}`;
  }

  /**
   * Only computable when this install owns a domain mapping — there is no
   * persisted "default alias URL" on the row to fall back to (unlike the
   * installer's in-flight `deployment.urls.default`), so a domain-less app
   * simply has no catalog `appUrl` and the admin UI links to the deployment
   * instead.
   */
  private computeAppUrl(manifest: AppManifest, row: InstalledApp): string | undefined {
    if (!row.domainId) return undefined;
    const appHost = this.computeAppHost(manifest);
    return appHost ? `https://${appHost}` : undefined;
  }

  private computeAppHost(manifest: AppManifest): string | null {
    const subdomain = manifest.install.domain?.subdomain;
    if (!subdomain) return null;
    const primaryDomain = this.configService.get<string>('PRIMARY_DOMAIN') || '';
    return primaryDomain ? `${subdomain}.${primaryDomain}` : null;
  }

  private applicableManualSteps(manifest: AppManifest): AppManualStep[] {
    const ctx = this.instanceContext();
    return (manifest.install.manualSteps ?? []).filter((step) => manualStepApplies(step, ctx));
  }

  /** Mirrors `AppInstallerService`'s private helper of the same name — small enough that
   * extracting a shared util isn't worth the cross-module coupling yet. */
  private instanceContext(): { bucketStorage: boolean; platformMode: boolean } {
    return {
      bucketStorage: resolveLocalAdapter(this.storageAdapter) === null,
      platformMode:
        this.configService.get<string>('PLATFORM_MODE') === 'true' ||
        process.env.PLATFORM_MODE === 'true',
    };
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
}

/**
 * An app can (in principle) be installed into more than one project, but
 * `CatalogEntry.installed` is singular — the catalog is a browse view, not a
 * per-project inventory. Picks the most recently touched row so the entry
 * reflects whatever the operator did last.
 */
function pickPrimaryRow(rows: InstalledApp[]): InstalledApp {
  return rows.reduce((latest, row) => (row.updatedAt > latest.updatedAt ? row : latest));
}
