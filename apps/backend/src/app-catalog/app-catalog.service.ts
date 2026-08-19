import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import {
  deploymentAliases,
  domainMappings,
  installedApps,
  type InstalledApp,
  type InstalledAppStatus,
} from '../db/schema';
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
import { AppCertStepService } from './app-cert-step.service';
import { compareSemver } from './ce-version.util';
import {
  manualStepApplies,
  interpolateStep,
  isReservedSubdomain,
  type StepPlaceholders,
} from './app-manifest.util';
import { suggestSubdomain } from './suggest-subdomain.util';
import type { AppManifest, AppManualStep, AppRegistryEntry } from './app-manifest.types';
import type { PreflightRequestDto } from './app-catalog.dtos';

/** A resolved domain row: the host plus whether THIS origin terminates TLS for it. */
interface DomainRef {
  domain: string;
  sslEnabled: boolean;
}

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
  /** Long-form markdown blurb. Registry-only — see AppRegistryEntry.description. */
  description?: string;
  category?: string;
  iconUrl?: string;
  /** Wide card image for the catalog grid. Registry-only. */
  thumbnailUrl?: string;
  /** Absolute https URLs. Registry-only. */
  screenshots?: string[];
  docsUrl?: string;
  sourceUrl?: string;
  /** Absent when the registry is unavailable, or this app isn't (or no longer) listed in it. */
  registryVersion?: string;
  /** Instance-level gates only (storage/CE-version/platform-config) — project gates are preflight-only. */
  gates: GateResult[];
  /** Every instance gate passed AND the app is present in the registry. */
  installable: boolean;
  /**
   * Every install of this app on the instance, oldest first. An app can be
   * installed into many projects (`installed_apps` is unique on
   * `(app_id, project_id)`), each on its own version — so this is a list, and
   * `updateAvailable` is per element. Empty when the app isn't installed.
   */
  installs: InstalledSummary[];
}

/** One installed_apps row, as the catalog presents it. */
export interface InstalledSummary {
  installedAppId: string;
  version: string;
  projectId: string;
  projectName: string;
  alias: string;
  appUrl?: string;
  status: InstalledAppStatus;
  updateAvailable: boolean;
  /** ISO timestamps — the per-install version trail (`updatedAt` moves on every update job). */
  installedAt: string;
  updatedAt: string;
  manualSteps: AppManualStep[];
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
  /**
   * A free subdomain the wizard can prefill when the manifest's default host
   * is already mapped (the app is being installed again, into another
   * project). Only computed when the request carries no `subdomain` of its own.
   */
  suggestedSubdomain?: string;
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
  private readonly logger = new Logger(AppCatalogService.name);

  constructor(
    private readonly projectsService: ProjectsService,
    private readonly configService: ConfigService,
    private readonly registryService: AppsRegistryService,
    private readonly bundleService: AppBundleService,
    private readonly preflightService: AppPreflightService,
    private readonly installerService: AppInstallerService,
    private readonly jobsService: AppInstallJobsService,
    private readonly certStepService: AppCertStepService,
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

    const domainsById = await this.fetchDomainsById(rows);

    const data: CatalogEntry[] = [];
    const seen = new Set<string>();

    if (registryResult.ok) {
      for (const entry of registryResult.registry.apps) {
        seen.add(entry.id);
        data.push(
          await this.buildRegistryEntry(entry, rowsByAppId.get(entry.id) ?? [], domainsById),
        );
      }
    }

    for (const [appId, appRows] of rowsByAppId) {
      if (seen.has(appId)) continue;
      data.push(await this.buildManifestOnlyEntry(appRows, domainsById));
    }

    return registryResult.ok ? { data } : { data, registryError: registryResult.error };
  }

  /** Combined instance + project gates, for the install wizard's preview screen. */
  async preflight(
    appId: string,
    dto: PreflightRequestDto,
    userId: string,
  ): Promise<PreflightResult> {
    const entry = await this.requireRegistryEntry(appId);
    const target = this.toInstallTarget(dto);
    const bundle = await this.bundleService.fetchBundle(entry.bundleUrl, entry.sha256);

    const instanceGates = await this.preflightService.instanceGates(entry.requires);
    const {
      gates: projectGates,
      syncPlans,
      appHost,
    } = await this.preflightService.projectGates(
      bundle,
      this.toPreflightTarget(target),
      userId,
      dto.subdomain,
    );

    const suggestedSubdomain =
      dto.subdomain === undefined
        ? await this.suggestFreeSubdomain(bundle.manifest, target)
        : undefined;

    return {
      gates: [...instanceGates, ...projectGates],
      syncPlans,
      appHost,
      appUrl: appHost ? `https://${appHost}` : undefined,
      ...(suggestedSubdomain ? { suggestedSubdomain } : {}),
    };
  }

  /**
   * Install-again support: when the manifest's default host is already mapped
   * (by this app's install in another project, typically), propose
   * `<default>-<project>` so the operator isn't left to invent a host that
   * clears the name-collision gate. `undefined` whenever the default is free,
   * the manifest has no default host, or no candidate turns out to be free.
   */
  private async suggestFreeSubdomain(
    manifest: AppManifest,
    target: InstallTarget,
  ): Promise<string | undefined> {
    const defaultSubdomain = manifest.install.domain?.subdomain;
    const primaryDomain = this.configService.get<string>('PRIMARY_DOMAIN') || '';
    if (!defaultSubdomain || !primaryDomain) return undefined;

    if (!(await this.hostIsMapped(`${defaultSubdomain}.${primaryDomain}`))) return undefined;

    const projectName = target.projectId
      ? (await this.projectsService.getProjectById(target.projectId)).name
      : target.newProject?.name;
    if (!projectName) return undefined;

    return suggestSubdomain({
      defaultSubdomain,
      projectName,
      isReserved: isReservedSubdomain,
      isTaken: async (candidate) =>
        (await this.hostIsMapped(`${candidate}.${primaryDomain}`)) ||
        (await this.aliasExistsAnywhere(candidate)),
    });
  }

  private async hostIsMapped(host: string): Promise<boolean> {
    const [row] = await db
      .select({ id: domainMappings.id })
      .from(domainMappings)
      .where(eq(domainMappings.domain, host))
      .limit(1);
    return Boolean(row);
  }

  /** Any project's alias of that name would answer at `<name>.PRIMARY_DOMAIN` via the wildcard route. */
  private async aliasExistsAnywhere(alias: string): Promise<boolean> {
    const [row] = await db
      .select({ id: deploymentAliases.id })
      .from(deploymentAliases)
      .where(eq(deploymentAliases.alias, alias))
      .limit(1);
    return Boolean(row);
  }

  async install(
    appId: string,
    dto: PreflightRequestDto,
    userId: string,
  ): Promise<{ jobId: string }> {
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
  async undoJob(
    jobId: string,
    userId: string,
  ): Promise<{ removed: string[]; failures?: string[] }> {
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

  uninstall(
    installedAppId: string,
    deleteData: boolean,
    userId: string,
  ): Promise<UninstallSummary> {
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

  // ==================== catalog assembly helpers ====================

  private async buildRegistryEntry(
    entry: AppRegistryEntry,
    rows: InstalledApp[],
    domainsById: Map<string, DomainRef>,
  ): Promise<CatalogEntry> {
    const gates = await this.preflightService.instanceGates(entry.requires);
    const base: CatalogEntry = {
      id: entry.id,
      name: entry.name ?? entry.id,
      summary: entry.summary,
      description: entry.description,
      category: entry.category,
      iconUrl: entry.iconUrl,
      thumbnailUrl: entry.thumbnailUrl,
      screenshots: entry.screenshots,
      docsUrl: entry.docsUrl,
      sourceUrl: entry.sourceUrl,
      registryVersion: entry.version,
      gates,
      installable: gates.every((gate) => gate.status !== 'fail'),
      installs: await this.buildInstalledSummaries(rows, entry.version, domainsById),
    };
    return base;
  }

  /** An installed app whose app id isn't (or no longer is) in the registry. */
  private async buildManifestOnlyEntry(
    rows: InstalledApp[],
    domainsById: Map<string, DomainRef>,
  ): Promise<CatalogEntry> {
    // Every row of a delisted app carries the same app's manifest (possibly at
    // different versions); the metadata fields read here are stable across
    // versions, so any row will do — take the oldest install's.
    const manifest = sortByInstalledAt(rows)[0].manifest as AppManifest;
    const gates = await this.preflightService.instanceGates(manifest.requires);

    // `description`/`thumbnailUrl`/`screenshots` are registry-only (the store
    // folds them in from apps/<app>/catalog/, they never reach the bundled
    // manifest), so a delisted app renders with just its manifest metadata.
    return {
      id: manifest.id,
      name: manifest.name,
      summary: manifest.summary,
      category: manifest.category,
      iconUrl: manifest.iconUrl,
      docsUrl: manifest.docsUrl,
      sourceUrl: manifest.sourceUrl,
      gates,
      installable: false, // no registry entry to install/reinstall from
      installs: await this.buildInstalledSummaries(rows, undefined, domainsById),
    };
  }

  private async buildInstalledSummaries(
    rows: InstalledApp[],
    registryVersion: string | undefined,
    domainsById: Map<string, DomainRef>,
  ): Promise<InstalledSummary[]> {
    return Promise.all(
      sortByInstalledAt(rows).map((row) =>
        this.buildInstalledSummary(row, registryVersion, domainsById),
      ),
    );
  }

  private async buildInstalledSummary(
    row: InstalledApp,
    registryVersion: string | undefined,
    domainsById: Map<string, DomainRef>,
  ): Promise<InstalledSummary> {
    const manifest = row.manifest as AppManifest;
    const project = await this.projectsService.getProjectById(row.projectId);
    const updateAvailable =
      registryVersion !== undefined && compareSemver(registryVersion, row.version) > 0;

    const projectPath = `${project.owner}/${project.name}`;
    const appHost = row.domainId ? domainsById.get(row.domainId)?.domain : undefined;
    const appUrl = await this.resolveAppUrl(row, domainsById);

    return {
      installedAppId: row.id,
      version: row.version,
      projectId: row.projectId,
      projectName: projectPath,
      alias: row.alias,
      appUrl,
      status: row.status,
      updateAvailable,
      installedAt: row.installedAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      manualSteps: [
        ...this.applicableManualSteps(manifest, { projectPath, appHost }),
        ...(await this.certManualStep(appHost)),
      ],
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
   * Batch-fetches the `domain_mappings.domain` string for every row's
   * `domainId` in one query, so `listCatalog` doesn't issue an N+1 lookup per
   * installed row.
   */
  private async fetchDomainsById(rows: InstalledApp[]): Promise<Map<string, DomainRef>> {
    const domainIds = [
      ...new Set(rows.map((row) => row.domainId).filter((id): id is string => Boolean(id))),
    ];
    if (domainIds.length === 0) return new Map();

    const mappings = await db
      .select({
        id: domainMappings.id,
        domain: domainMappings.domain,
        sslEnabled: domainMappings.sslEnabled,
      })
      .from(domainMappings)
      .where(inArray(domainMappings.id, domainIds));

    return new Map(
      mappings.map((mapping) => [
        mapping.id,
        { domain: mapping.domain, sslEnabled: Boolean(mapping.sslEnabled) },
      ]),
    );
  }

  /**
   * The catalog card's "Open" link must point at wherever this install
   * ACTUALLY lives — the domain row its install (or update) created — not at
   * `manifest.install.domain.subdomain`, which is only the manifest's
   * *default* suggestion. The operator may have overridden the subdomain at
   * install time (e.g. manifest default `handoff`, operator chose `files`),
   * and reading the manifest back here would silently ignore that override.
   *
   * Only computable when this install owns a domain mapping — there is no
   * persisted "default alias URL" on the row to fall back to (unlike the
   * installer's in-flight `deployment.urls.default`). If `domainId` points at
   * a mapping that's since been deleted (operator removed it by hand), this
   * also yields `undefined` rather than guessing from the manifest — a stale
   * wrong link is worse than none, and the admin UI links to the deployment
   * instead.
   */
  private async resolveAppUrl(
    row: InstalledApp,
    domainsById: Map<string, DomainRef>,
  ): Promise<string | undefined> {
    if (!row.domainId) return undefined;
    const ref = domainsById.get(row.domainId);
    if (!ref) return undefined;
    // Same scheme rule as the install job: a direct-serving instance with no
    // certificate for this host serves it over plain HTTP (ce#584).
    const scheme = await this.certStepService.schemeFor(ref.domain, ref.sslEnabled);
    return `${scheme}://${ref.domain}`;
  }

  private applicableManualSteps(manifest: AppManifest, values: StepPlaceholders): AppManualStep[] {
    const ctx = this.instanceContext();
    return (manifest.install.manualSteps ?? [])
      .filter((step) => manualStepApplies(step, ctx))
      .map((step) => interpolateStep(step, values))
      .filter((step): step is AppManualStep => step !== null);
  }

  /**
   * The TLS note is synthesized during the install run and attached to the
   * in-memory job, so it used to vanish the moment the catalog refetched
   * (ce#584 follow-up). Re-deriving it here keeps it visible AND makes it
   * self-healing — it disappears on its own once a wildcard covers the host.
   *
   * `AppCertStepService` never throws by contract; the guard is for the day
   * that stops being true. A catalog that fails to list is worse than one
   * missing an advisory line.
   */
  private async certManualStep(appHost: string | undefined): Promise<AppManualStep[]> {
    if (!appHost) return [];
    try {
      const plan = await this.certStepService.plan(appHost);
      const result = await this.certStepService.execute(plan, appHost);
      return result.manualStep ? [result.manualStep] : [];
    } catch (error) {
      this.logger.warn(
        `Could not derive the certificate note for ${appHost}: ${(error as Error).message}`,
      );
      return [];
    }
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

/** Oldest install first — a stable order that doesn't reshuffle on every update. */
function sortByInstalledAt(rows: InstalledApp[]): InstalledApp[] {
  return [...rows].sort((a, b) => a.installedAt.getTime() - b.installedAt.getTime());
}
