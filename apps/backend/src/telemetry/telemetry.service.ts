import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { count, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { systemConfig, projects, users, deploymentAliases } from '../db/schema';

/**
 * TelemetryService — CE install telemetry (opt-out phone-home).
 *
 * **Why:** The business plan's distribution-to-revenue bridge depends on knowing
 * how many real CE instances are running inside companies (not just install.sh
 * downloads). This reports a privacy-respecting, anonymous heartbeat so adoption
 * is measurable instead of invisible.
 *
 * **What is sent:** a stable random install id, CE version, OS/arch/node, the
 * storage provider in use, and *bucketed* counts (e.g. "2-5") of projects /
 * deployments / users. Never: domains, asset content, user emails, project names.
 *
 * **Opt-out:** ON by default. Disabled by `TELEMETRY=off` (env always wins) or by
 * the `telemetry_enabled` flag in system_config (toggled from admin settings — no
 * restart needed; the flag is re-read on every send).
 *
 * **Platform mode:** skipped entirely when running as a Platform workspace
 * (WORKSPACE_ID set) — those instances are tracked via the Control Plane, so we
 * only ever count CE self-hosted installs here.
 *
 * **Fire-and-forget:** never blocks boot, never throws; a short timeout and a
 * catch-all keep a slow/unreachable collector from affecting the app.
 */
@Injectable()
export class TelemetryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelemetryService.name);

  private readonly endpoint: string;
  private readonly envDisabled: boolean;
  private readonly isWorkspaceMode: boolean;

  private readonly INITIAL_DELAY_MS = 30_000; // let the app finish booting first
  private readonly HEARTBEAT_MS = 7 * 24 * 60 * 60 * 1000; // weekly
  private readonly REQUEST_TIMEOUT_MS = 5_000;

  private initialTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(private readonly configService: ConfigService) {
    this.endpoint =
      this.configService.get<string>('TELEMETRY_ENDPOINT') || 'https://bffless.app/api/telemetry';

    const flag = (this.configService.get<string>('TELEMETRY') || '').trim().toLowerCase();
    const explicitDisable = this.configService.get<string>('BFFLESS_TELEMETRY_DISABLED');
    this.envDisabled =
      flag === 'off' ||
      flag === 'false' ||
      flag === '0' ||
      flag === 'disabled' ||
      explicitDisable === 'true' ||
      explicitDisable === '1';

    // Platform workspaces are tracked via the Control Plane; never double-count them here.
    this.isWorkspaceMode = !!this.configService.get<string>('WORKSPACE_ID');
  }

  onModuleInit(): void {
    if (this.envDisabled) {
      this.logger.log('Install telemetry disabled via environment (TELEMETRY=off)');
      return;
    }
    if (this.isWorkspaceMode) {
      this.logger.debug('Install telemetry skipped (Platform workspace mode)');
      return;
    }

    // First ping shortly after boot, then a weekly heartbeat. Both are guarded by
    // the DB opt-out flag at send time, so toggling it off takes effect without restart.
    this.initialTimer = setTimeout(() => {
      void this.sendPing('first_seen');
    }, this.INITIAL_DELAY_MS);
    this.initialTimer.unref?.();

    this.heartbeatTimer = setInterval(() => {
      void this.sendPing('heartbeat');
    }, this.HEARTBEAT_MS);
    this.heartbeatTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.initialTimer) clearTimeout(this.initialTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
  }

  /**
   * Build the payload and POST it. Fire-and-forget: any failure is swallowed.
   */
  private async sendPing(event: 'first_seen' | 'heartbeat'): Promise<void> {
    try {
      const config = await this.getConfigRow();
      if (!config || !config.isSetupComplete) {
        // Don't report half-configured instances; the first_seen will arrive after setup.
        return;
      }
      if (config.telemetryEnabled === false) {
        return; // opted out from admin settings
      }

      const installId = await this.ensureInstallId(config);

      const payload = {
        install_id: installId,
        event,
        version: this.getAppVersion(),
        os: process.platform,
        arch: process.arch,
        node_version: process.version,
        storage_provider: config.storageProvider || 'unknown',
        deployment_mode: 'ce',
        project_count_bucket: bucket(await this.safeCount(projects)),
        deployment_count_bucket: bucket(await this.safeCount(deploymentAliases)),
        user_count_bucket: bucket(await this.safeCount(users)),
      };

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.REQUEST_TIMEOUT_MS);
      try {
        const res = await fetch(this.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': `bffless-ce-telemetry/${payload.version}`,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        if (!res.ok) {
          this.logger.debug(`Telemetry ping returned HTTP ${res.status}`);
          return;
        }
      } finally {
        clearTimeout(timeout);
      }

      await db
        .update(systemConfig)
        .set({ telemetryLastSent: new Date(), updatedAt: new Date() })
        .where(eq(systemConfig.id, config.id));

      this.logger.debug(`Sent ${event} telemetry ping`);
    } catch (error) {
      // Fire-and-forget: log at debug, never throw.
      this.logger.debug(
        `Telemetry ping skipped: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  private async getConfigRow() {
    const rows = await db.select().from(systemConfig).limit(1);
    return rows[0];
  }

  /**
   * Existing installs migrated before install_id existed may have a null id; backfill once.
   */
  private async ensureInstallId(config: typeof systemConfig.$inferSelect): Promise<string> {
    if (config.installId) return config.installId;
    const installId = randomUUID();
    await db
      .update(systemConfig)
      .set({ installId, updatedAt: new Date() })
      .where(eq(systemConfig.id, config.id));
    return installId;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async safeCount(table: any): Promise<number> {
    try {
      const [row] = await db.select({ value: count() }).from(table);
      return Number(row?.value ?? 0);
    } catch {
      return 0;
    }
  }

  /**
   * Read the app version from package.json (CommonJS runtime). Best-effort.
   */
  private getAppVersion(): string {
    const envVersion = process.env.npm_package_version;
    if (envVersion) return envVersion;
    const candidates = [
      path.join(process.cwd(), 'package.json'),
      path.join(__dirname, '..', '..', 'package.json'),
    ];
    for (const file of candidates) {
      try {
        const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (pkg?.version) return String(pkg.version);
      } catch {
        // try next candidate
      }
    }
    return 'unknown';
  }
}

/**
 * Bucket a raw count into a coarse range so it can't be used to fingerprint an instance.
 */
function bucket(n: number): string {
  if (n <= 0) return '0';
  if (n === 1) return '1';
  if (n <= 5) return '2-5';
  if (n <= 20) return '6-20';
  if (n <= 100) return '21-100';
  return '100+';
}
