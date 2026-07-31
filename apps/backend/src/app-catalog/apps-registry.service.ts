import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getCeVersion } from './ce-version.util';
import { validateRegistry } from './app-manifest.util';
import type { AppRegistry } from './app-manifest.types';

export type RegistryResult =
  | { ok: true; registry: AppRegistry; fetchedAt: string }
  | { ok: false; error: string };

interface RegistryCache {
  registry: AppRegistry;
  fetchedAt: number;
}

/**
 * AppsRegistryService — fetches and caches the app catalog registry.
 *
 * Stale-while-error: once a fetch has succeeded, any later failed refresh
 * (network error, non-200, or invalid JSON) — even past the TTL — serves the
 * last-known-good cache with `ok: true` rather than surfacing the failure.
 * Installed apps must keep working when the registry endpoint blips.
 */
@Injectable()
export class AppsRegistryService {
  private readonly logger = new Logger(AppsRegistryService.name);
  private readonly url: string;
  private readonly TTL_MS = 3600_000;
  private readonly REQUEST_TIMEOUT_MS = 10_000;
  private cache: RegistryCache | null = null;

  constructor(private readonly configService: ConfigService) {
    this.url =
      this.configService.get<string>('APPS_REGISTRY_URL') || 'https://apps.bffless.dev/registry.json';
  }

  async getRegistry(force?: boolean): Promise<RegistryResult> {
    if (!force && this.cache && Date.now() - this.cache.fetchedAt < this.TTL_MS) {
      return { ok: true, registry: this.cache.registry, fetchedAt: new Date(this.cache.fetchedAt).toISOString() };
    }

    try {
      const registry = await this.fetchAndValidate();
      this.cache = { registry, fetchedAt: Date.now() };
      return { ok: true, registry, fetchedAt: new Date(this.cache.fetchedAt).toISOString() };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      if (this.cache) {
        this.logger.warn(`Registry refresh failed, serving stale cache: ${message}`);
        return {
          ok: true,
          registry: this.cache.registry,
          fetchedAt: new Date(this.cache.fetchedAt).toISOString(),
        };
      }
      this.logger.warn(`Registry fetch failed with no cache available: ${message}`);
      return { ok: false, error: message };
    }
  }

  private async fetchAndValidate(): Promise<AppRegistry> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(this.url, {
        headers: { 'User-Agent': `bffless-ce-app-catalog/${getCeVersion()}` },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      throw new Error(`Registry fetch returned HTTP ${res.status}`);
    }

    const json = await res.json();
    const result = validateRegistry(json);
    if (!result.ok) {
      throw new Error(`Registry failed validation: ${result.errors.join('; ')}`);
    }
    return result.registry;
  }
}
