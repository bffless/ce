import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { deploymentAliases, domainMappings, installedApps, proxyRuleSets } from '../db/schema';
import { ProxyRuleSetsService } from '../proxy-rules/proxy-rule-sets.service';
import type {
  SyncProxyRuleSetDto,
  SyncProxyRuleDto,
  SyncSchemaDto,
} from '../proxy-rules/dto/sync-proxy-rule-set.dto';
import { BootstrapDnsPreflightService } from '../setup/bootstrap-dns-preflight.service';
import { IStorageAdapter, STORAGE_ADAPTER } from '../storage/storage.interface';
import { getCeVersion, satisfiesMin } from './ce-version.util';
import type { AppManifest, AppManifestRequires } from './app-manifest.types';
import type { LoadedBundle } from './app-bundle.service';

export type GateStatus = 'pass' | 'fail' | 'warn';

export interface GateResult {
  id: 'storage' | 'ce-version' | 'platform-config' | 'dns' | 'name-collision' | 'data-tables';
  status: GateStatus;
  message: string;
  remediation?: string;
  deepLink?: string;
  /** DNS is blocking-but-retryable; name collisions are not. */
  retryable?: boolean;
}

export interface SyncSchemaResolutionLike {
  name: string;
  action: 'reuse' | 'create';
  fieldMismatch: boolean;
}

export interface SyncPlanSummary {
  ruleSet: string;
  created: number;
  updated: number;
  unchanged: number;
  pruneCandidates: number;
  schemaResolutions: SyncSchemaResolutionLike[];
}

export type InstallTarget = { projectId: string } | { newProject: { owner: string; name: string } };

interface ParsedRuleSetFile {
  file: string;
  dto: SyncProxyRuleSetDto;
}

/**
 * AppPreflightService — computes the gate checks the install wizard shows
 * before an app is actually installed (Task 7 of the app-catalog spec).
 *
 * Two independent surfaces:
 *  - `instanceGates`: checks about THIS BFFless instance (storage backend,
 *    CE version, platform-mode config) — same result regardless of target
 *    project.
 *  - `projectGates`: checks scoped to the install target (DNS, naming
 *    collisions, and a dryRun preview of the data-table/rule-set sync).
 *
 * `projectGates` never writes anything: the proxy-rule-set sync always runs
 * with `options.dryRun: true` (verified zero-write in
 * `proxy-rule-sets.service.ts`), and all db reads here are plain selects.
 */
@Injectable()
export class AppPreflightService {
  constructor(
    @Inject(STORAGE_ADAPTER) private readonly storageAdapter: IStorageAdapter,
    private readonly configService: ConfigService,
    private readonly dnsPreflight: BootstrapDnsPreflightService,
    private readonly proxyRuleSetsService: ProxyRuleSetsService,
  ) {}

  async instanceGates(requires?: AppManifestRequires): Promise<GateResult[]> {
    return [this.storageGate(requires), this.ceVersionGate(requires), ...this.platformConfigGates()];
  }

  async projectGates(
    bundle: LoadedBundle,
    target: InstallTarget,
    userId: string,
  ): Promise<{ gates: GateResult[]; syncPlans: SyncPlanSummary[]; appHost: string | null }> {
    const manifest = bundle.manifest;
    const subdomain = manifest.install.domain?.subdomain;
    const primaryDomain = this.configService.get<string>('PRIMARY_DOMAIN') || '';
    const appHost = subdomain ? `${subdomain}.${primaryDomain}` : null;
    const ruleSets = this.parseBundledRuleSets(bundle);

    const dns = await this.dnsGate(appHost, subdomain, primaryDomain);
    const nameCollision = await this.nameCollisionGate(manifest, ruleSets, target, appHost, subdomain);
    const { gate: dataTables, syncPlans } = await this.dataTablesGate(ruleSets, target, userId);

    return { gates: [dns, nameCollision, dataTables], syncPlans, appHost };
  }

  // ---- instance gates -----------------------------------------------------

  private storageGate(requires?: AppManifestRequires): GateResult {
    if (!requires?.presignedStorage) {
      return {
        id: 'storage',
        status: 'pass',
        message: 'This app does not require presigned upload URLs.',
      };
    }

    const supportsPresigned = this.storageAdapter.supportsPresignedUrls?.() ?? false;
    if (supportsPresigned) {
      return {
        id: 'storage',
        status: 'pass',
        message: 'The active storage adapter supports presigned upload URLs.',
      };
    }

    return {
      id: 'storage',
      status: 'fail',
      message: 'This app requires presigned upload URLs, but the active storage adapter does not support them.',
      remediation:
        'Enable bundled MinIO storage (set ENABLE_MINIO=true and restart), or switch to a real S3-compatible ' +
        'bucket. Since CE v0.3.15, local filesystem storage also supports presigned uploads when ENCRYPTION_KEY ' +
        'is set and the FEATURE_LOCAL_PRESIGNED_UPLOADS flag is not disabled — this failure usually means that ' +
        'flag was turned off or ENCRYPTION_KEY is missing.',
    };
  }

  private ceVersionGate(requires?: AppManifestRequires): GateResult {
    if (!requires?.ceMin) {
      return {
        id: 'ce-version',
        status: 'pass',
        message: 'This app has no minimum CE version requirement.',
      };
    }

    const version = getCeVersion();
    if (version === 'unknown') {
      return {
        id: 'ce-version',
        status: 'fail',
        message:
          `This instance's CE version could not be determined, so we cannot confirm it satisfies the ` +
          `required minimum (${requires.ceMin}).`,
        remediation: 'Verify this is a genuine BFFless CE deployment with an intact root package.json.',
      };
    }

    if (!satisfiesMin(version, requires.ceMin)) {
      return {
        id: 'ce-version',
        status: 'fail',
        message: `This instance is running CE ${version}, which is below the required minimum ${requires.ceMin}.`,
        remediation: `Upgrade this BFFless CE instance to v${requires.ceMin} or later.`,
      };
    }

    return {
      id: 'ce-version',
      status: 'pass',
      message: `This instance is running CE ${version}, which satisfies the required minimum ${requires.ceMin}.`,
    };
  }

  private platformConfigGates(): GateResult[] {
    const platformMode = this.configService.get<string>('PLATFORM_MODE') === 'true';
    if (!platformMode) return [];

    const gates: GateResult[] = [];
    const controlPlaneUrl = this.configService.get<string>('CONTROL_PLANE_URL');
    const workspaceId = this.configService.get<string>('WORKSPACE_ID');

    if (!controlPlaneUrl || !workspaceId) {
      gates.push({
        id: 'platform-config',
        status: 'fail',
        message: 'Platform mode is enabled but CONTROL_PLANE_URL and/or WORKSPACE_ID is not configured.',
        remediation: "Set CONTROL_PLANE_URL and WORKSPACE_ID in this workspace's environment.",
      });
    } else {
      gates.push({
        id: 'platform-config',
        status: 'pass',
        message: 'CONTROL_PLANE_URL and WORKSPACE_ID are configured.',
      });
    }

    gates.push({
      id: 'platform-config',
      status: 'warn',
      message:
        "This app's subdomain resolves under <sub>.<workspace>.<platform-domain> — a two-label subdomain that " +
        'is NOT covered by a *.<platform-domain> wildcard certificate.',
      remediation:
        "Provision a certificate covering <workspace>.<platform-domain>'s wildcard, or a dedicated certificate " +
        "for this app's host.",
    });

    return gates;
  }

  // ---- project gates -------------------------------------------------------

  private async dnsGate(
    appHost: string | null,
    subdomain: string | undefined,
    primaryDomain: string,
  ): Promise<GateResult> {
    if (!appHost) {
      return {
        id: 'dns',
        status: 'pass',
        message: 'This app does not declare a domain; DNS check skipped.',
      };
    }

    const check = await this.dnsPreflight.probeHost(appHost);
    if (check.probeOk) {
      return {
        id: 'dns',
        status: 'pass',
        message: `${appHost} resolves and answered the preflight probe.`,
      };
    }

    const resolvedIps = check.resolvedIps.length ? check.resolvedIps.join(', ') : 'none';
    return {
      id: 'dns',
      status: 'fail',
      retryable: true,
      message:
        `DNS check failed for ${appHost}: ${check.error ?? 'probe did not succeed'}. ` +
        `Resolved IPs: ${resolvedIps}.`,
      remediation:
        `Add a CNAME record "${subdomain}" pointing to "${primaryDomain}" (or an A record matching ` +
        `${primaryDomain}'s IP), then retry.`,
    };
  }

  private async nameCollisionGate(
    manifest: AppManifest,
    ruleSets: ParsedRuleSetFile[],
    target: InstallTarget,
    appHost: string | null,
    subdomain: string | undefined,
  ): Promise<GateResult> {
    const issues: string[] = [];
    let existingInstall: typeof installedApps.$inferSelect | undefined;

    if ('projectId' in target) {
      const projectId = target.projectId;
      [existingInstall] = await db
        .select()
        .from(installedApps)
        .where(and(eq(installedApps.appId, manifest.id), eq(installedApps.projectId, projectId)))
        .limit(1);

      for (const { dto } of ruleSets) {
        const name = dto.ruleSet.name;
        const [existingSet] = await db
          .select()
          .from(proxyRuleSets)
          .where(and(eq(proxyRuleSets.projectId, projectId), eq(proxyRuleSets.name, name)))
          .limit(1);
        const ownedByThisInstall = existingInstall?.ruleSetIds?.includes(existingSet?.id) ?? false;
        if (existingSet && !ownedByThisInstall) {
          issues.push(
            `A rule set named "${name}" already exists in this project and is not part of this app's install.`,
          );
        }
      }

      const alias = manifest.install.alias;
      const [existingAlias] = await db
        .select()
        .from(deploymentAliases)
        .where(and(eq(deploymentAliases.projectId, projectId), eq(deploymentAliases.alias, alias)))
        .limit(1);
      const aliasOwnedByThisInstall = existingInstall?.alias === alias;
      if (existingAlias && !aliasOwnedByThisInstall) {
        issues.push(`An alias named "${alias}" already exists in this project.`);
      }
    }

    if (appHost) {
      const [existingDomain] = await db
        .select()
        .from(domainMappings)
        .where(eq(domainMappings.domain, appHost))
        .limit(1);
      const domainOwnedByThisInstall = existingInstall?.domainId === existingDomain?.id;
      if (existingDomain && !domainOwnedByThisInstall) {
        issues.push(`The domain "${appHost}" is already mapped and does not belong to this app's install.`);
      }
    }

    if (subdomain) {
      const crossNamespaceRows = await db
        .select()
        .from(deploymentAliases)
        .where(eq(deploymentAliases.alias, subdomain));
      const foreign = crossNamespaceRows.filter((row: { projectId: string }) => {
        if (!('projectId' in target)) return true;
        return row.projectId !== target.projectId;
      });
      if (foreign.length > 0) {
        issues.push(
          `An alias named "${subdomain}" exists in another project and would be reachable at ${appHost} via ` +
            'the wildcard subdomain route, colliding with this app.',
        );
      }
    }

    if (issues.length > 0) {
      return {
        id: 'name-collision',
        status: 'fail',
        message: issues.join(' '),
        remediation: 'Rename the conflicting resource, choose a different subdomain/alias, or target a different project.',
      };
    }

    return { id: 'name-collision', status: 'pass', message: 'No naming collisions detected.' };
  }

  private async dataTablesGate(
    ruleSets: ParsedRuleSetFile[],
    target: InstallTarget,
    userId: string,
  ): Promise<{ gate: GateResult; syncPlans: SyncPlanSummary[] }> {
    const syncPlans: SyncPlanSummary[] = [];
    const mismatchedSchemas: string[] = [];

    for (const { dto } of ruleSets) {
      if ('projectId' in target) {
        const response = await this.proxyRuleSetsService.syncRuleSet(
          target.projectId,
          dto,
          userId,
          'admin',
          null,
        );
        const schemaResolutions: SyncSchemaResolutionLike[] = response.schemaResolutions.map((r) => ({
          name: r.name,
          action: r.action,
          fieldMismatch: r.fieldMismatch,
        }));
        for (const resolution of schemaResolutions) {
          if (resolution.fieldMismatch) mismatchedSchemas.push(resolution.name);
        }
        syncPlans.push({
          ruleSet: dto.ruleSet.name,
          created: response.created.length,
          updated: response.updated.length,
          unchanged: response.unchanged.length,
          pruneCandidates: response.pruneCandidates.length,
          schemaResolutions,
        });
      } else {
        const schemas = dto.schemas ?? [];
        syncPlans.push({
          ruleSet: dto.ruleSet.name,
          created: dto.rules.length,
          updated: 0,
          unchanged: 0,
          pruneCandidates: 0,
          schemaResolutions: schemas.map((schema) => ({
            name: schema.name,
            action: 'create' as const,
            fieldMismatch: false,
          })),
        });
      }
    }

    const gate: GateResult =
      mismatchedSchemas.length > 0
        ? {
            id: 'data-tables',
            status: 'warn',
            message: `Some reused data table schemas have mismatched field definitions: ${mismatchedSchemas.join(', ')}.`,
            remediation: 'Review the schema differences — reuse is the documented adoption path; this will not block install.',
          }
        : { id: 'data-tables', status: 'pass', message: 'Data table schemas are compatible.' };

    return { gate, syncPlans };
  }

  // ---- helpers --------------------------------------------------------------

  private parseBundledRuleSets(bundle: LoadedBundle): ParsedRuleSetFile[] {
    return bundle.manifest.install.ruleSets.map((entry) => {
      const bytes = bundle.files[entry.file];
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as {
        ruleSet: { name: string; description?: string; environment?: string };
        rules?: unknown[];
        schemas?: unknown[];
      };
      const dto: SyncProxyRuleSetDto = {
        ruleSet: parsed.ruleSet,
        rules: (parsed.rules ?? []) as unknown as SyncProxyRuleDto[],
        schemas: parsed.schemas as unknown as SyncSchemaDto[] | undefined,
        options: { dryRun: true },
      };
      return { file: entry.file, dto };
    });
  }
}
