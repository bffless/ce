import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { systemConfig } from '../db/schema';

export interface TelemetryStatus {
  /** Whether the opt-out flag in system_config is on. */
  enabled: boolean;
  /** True when TELEMETRY=off (env) forces telemetry off regardless of the flag. */
  forcedOffByEnv: boolean;
  /** ISO timestamp of the last successful phone-home, if any. */
  lastSentAt: string | null;
}

/**
 * Reads/writes the install-telemetry opt-out flag in system_config.
 * The actual sending lives in TelemetryService (telemetry module); this is just
 * the admin-settings surface for the flag, re-read by the sender on every ping.
 */
@Injectable()
export class TelemetrySettingsService {
  private readonly logger = new Logger(TelemetrySettingsService.name);

  private isForcedOffByEnv(): boolean {
    const flag = (process.env.TELEMETRY || '').trim().toLowerCase();
    const explicit = process.env.BFFLESS_TELEMETRY_DISABLED;
    return (
      flag === 'off' ||
      flag === 'false' ||
      flag === '0' ||
      flag === 'disabled' ||
      explicit === 'true' ||
      explicit === '1'
    );
  }

  async getStatus(): Promise<TelemetryStatus> {
    const [config] = await db.select().from(systemConfig).limit(1);
    return {
      enabled: config?.telemetryEnabled ?? true,
      forcedOffByEnv: this.isForcedOffByEnv(),
      lastSentAt: config?.telemetryLastSent ? config.telemetryLastSent.toISOString() : null,
    };
  }

  async setEnabled(enabled: boolean): Promise<TelemetryStatus> {
    const [config] = await db.select().from(systemConfig).limit(1);
    if (config) {
      await db
        .update(systemConfig)
        .set({ telemetryEnabled: enabled, updatedAt: new Date() })
        .where(eq(systemConfig.id, config.id));
    }
    this.logger.log(`Install telemetry ${enabled ? 'enabled' : 'disabled'} via settings`);
    return this.getStatus();
  }
}
