import { Injectable, Logger } from '@nestjs/common';
import picomatch from 'picomatch';
import { CacheRulesService } from './cache-rules.service';
import { CacheRule } from '../db/schema';

/**
 * Configuration resolved from cache rules for a specific request
 */
export interface CacheConfig {
  /** Browser cache max-age in seconds */
  browserMaxAge: number;
  /** CDN/proxy cache max-age in seconds (s-maxage), null = use browserMaxAge */
  cdnMaxAge: number | null;
  /** Stale-while-revalidate duration in seconds */
  staleWhileRevalidate: number | null;
  /** Whether content is immutable */
  immutable: boolean;
  /** Cache directive (public/private), null = inherit from visibility */
  cacheability: 'public' | 'private' | null;
  /** Source of this config: 'rule' = matched rule, 'default' = system default */
  source: 'rule' | 'default';
  /** The rule that matched (if source is 'rule') */
  matchedRule?: CacheRule;
}

interface CachedRules {
  rules: CacheRule[];
  matchers: picomatch.Matcher[];
  cachedAt: number;
}

// Cache TTL for rule lookups (5 minutes)
const RULE_CACHE_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class CacheConfigService {
  private readonly logger = new Logger(CacheConfigService.name);

  // In-memory cache for compiled glob matchers (projectId -> rules with matchers)
  private ruleCache = new Map<string, CachedRules>();

  constructor(private readonly cacheRulesService: CacheRulesService) {}

  /**
   * Get cache configuration for a specific file path.
   * Evaluates rules in priority order; first match wins.
   */
  async getCacheConfig(
    projectId: string,
    filePath: string,
    isImmutable: boolean,
  ): Promise<CacheConfig> {
    // Get cached rules or fetch from DB
    let cached = this.ruleCache.get(projectId);
    const now = Date.now();

    if (!cached || now - cached.cachedAt > RULE_CACHE_TTL_MS) {
      const rules = await this.cacheRulesService.getEnabledRulesByProjectId(projectId);
      const matchers = rules.map((r) => picomatch(r.pathPattern));
      cached = { rules, matchers, cachedAt: now };
      this.ruleCache.set(projectId, cached);
    }

    // Normalize path for matching (remove leading slashes)
    const normalizedPath = filePath.replace(/^\/+/, '');

    // Find first matching rule
    for (let i = 0; i < cached.rules.length; i++) {
      if (cached.matchers[i](normalizedPath)) {
        const rule = cached.rules[i];
        return {
          browserMaxAge: rule.browserMaxAge,
          cdnMaxAge: rule.cdnMaxAge,
          staleWhileRevalidate: rule.staleWhileRevalidate,
          immutable: rule.immutable,
          cacheability: rule.cacheability,
          source: 'rule',
          matchedRule: rule,
        };
      }
    }

    // No rule matched - return defaults based on URL type (immutable = SHA-based)
    if (isImmutable) {
      return {
        browserMaxAge: 31536000, // 1 year
        cdnMaxAge: null,
        staleWhileRevalidate: null,
        immutable: true,
        cacheability: null, // inherit from visibility
        source: 'default',
      };
    } else {
      // HTML files should not be cached by the browser since they're the entry point
      // and aliases can change at any time. Other assets get 5 min cache.
      const isHtml = /\.html?$/i.test(normalizedPath);
      return {
        browserMaxAge: isHtml ? 0 : 300,
        cdnMaxAge: null,
        staleWhileRevalidate: null,
        immutable: false,
        cacheability: null, // inherit from visibility
        source: 'default',
      };
    }
  }

  /**
   * Build Cache-Control header string from cache config
   */
  buildCacheControlHeader(config: CacheConfig, isPublicContent: boolean): string {
    const directives: string[] = [];

    // Cacheability (public/private)
    // If config specifies cacheability, use it; otherwise inherit from content visibility
    const cacheability = config.cacheability ?? (isPublicContent ? 'public' : 'private');
    directives.push(cacheability);

    // max-age (browser cache)
    directives.push(`max-age=${config.browserMaxAge}`);

    // s-maxage (CDN cache) - only add if different from browserMaxAge
    if (config.cdnMaxAge !== null && config.cdnMaxAge !== config.browserMaxAge) {
      directives.push(`s-maxage=${config.cdnMaxAge}`);
    }

    // stale-while-revalidate
    if (config.staleWhileRevalidate !== null && config.staleWhileRevalidate > 0) {
      directives.push(`stale-while-revalidate=${config.staleWhileRevalidate}`);
    }

    // immutable or must-revalidate
    if (config.immutable) {
      directives.push('immutable');
    } else {
      // For mutable content, add must-revalidate to ensure fresh content after expiry
      directives.push('must-revalidate');
    }

    return directives.join(', ');
  }

  /**
   * Calculate Redis TTL based on cache config.
   * Formula: max(browserMaxAge, cdnMaxAge ?? 0) + 60 seconds buffer
   * Minimum: 300 seconds (5 minutes)
   */
  calculateRedisTtl(config: CacheConfig): number {
    const httpTtl = Math.max(config.browserMaxAge, config.cdnMaxAge ?? 0);
    const redisTtl = httpTtl + 60; // 60 second buffer for revalidation timing
    return Math.max(redisTtl, 300); // Minimum 5 minutes
  }

  /**
   * Invalidate cached rules for a project.
   * Call this when rules are created/updated/deleted.
   */
  invalidateProjectCache(projectId: string): void {
    this.ruleCache.delete(projectId);
    this.logger.debug(`Invalidated cache rule cache for project ${projectId}`);
  }

  /**
   * Clear all cached rules (useful for testing)
   */
  clearAllCache(): void {
    this.ruleCache.clear();
    this.logger.debug('Cleared all cache rule caches');
  }
}
