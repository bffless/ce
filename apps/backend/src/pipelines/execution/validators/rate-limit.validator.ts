import { Injectable, Logger } from '@nestjs/common';
import { Validator, RateLimitValidatorConfig } from '../validator.interface';
import { ValidatorRegistry } from '../validator.registry';
import { PipelineContext } from '../pipeline-context.interface';
import { ValidatorConfig } from '../../types';
import { RateLimitError } from '../../errors';
import { ConfigurationError } from '../../errors';

interface RateLimitEntry {
  count: number;
  windowStart: number;
  /** Window duration in ms - stored for proper cleanup */
  windowMs: number;
}

/**
 * Rate Limit Validator
 *
 * Limits the number of requests to a pipeline within a time window.
 * Uses in-memory storage with proper isolation per pipeline/config.
 *
 * Key format: "{pipelineId}:{limit}:{windowSeconds}:{keyBy}:{identifier}"
 * This ensures different validators (even on the same pipeline) have separate counters.
 */
@Injectable()
export class RateLimitValidator implements Validator<RateLimitValidatorConfig> {
  readonly type = 'rate_limit' as const;
  private readonly logger = new Logger(RateLimitValidator.name);

  // In-memory rate limit store
  private readonly rateLimitStore = new Map<string, RateLimitEntry>();

  // Cleanup interval (every minute)
  private readonly cleanupInterval: ReturnType<typeof setInterval>;

  // Maximum entries to prevent unbounded growth (safety valve)
  private readonly MAX_ENTRIES = 100_000;

  constructor(private readonly registry: ValidatorRegistry) {
    this.registry.register(this);

    // Start cleanup interval - runs every minute
    this.cleanupInterval = setInterval(() => this.cleanupExpiredEntries(), 60 * 1000);
  }

  validateConfig(config: RateLimitValidatorConfig): void {
    if (typeof config.limit !== 'number' || config.limit <= 0) {
      throw new ConfigurationError('rate_limit validator: limit must be a positive number');
    }

    if (typeof config.windowSeconds !== 'number' || config.windowSeconds <= 0) {
      throw new ConfigurationError('rate_limit validator: windowSeconds must be a positive number');
    }

    if (config.keyBy !== undefined && !['ip', 'user', 'ip+user'].includes(config.keyBy)) {
      throw new ConfigurationError(
        "rate_limit validator: keyBy must be 'ip', 'user', or 'ip+user'",
      );
    }
  }

  async validate(context: PipelineContext, validatorConfig: ValidatorConfig): Promise<void> {
    // Type narrowing via discriminated union
    if (validatorConfig.type !== 'rate_limit') {
      throw new ConfigurationError(
        `RateLimitValidator received wrong config type: ${validatorConfig.type}`,
      );
    }
    const config = validatorConfig.config;
    const { limit, windowSeconds, keyBy = 'ip' } = config;

    // Generate the rate limit key (includes pipeline + config for isolation)
    const key = this.generateKey(context, config);

    if (!key) {
      // If we can't generate a key (e.g., no user when keyBy='user'), skip rate limiting
      this.logger.debug(
        `Cannot generate rate limit key for keyBy='${keyBy}', skipping rate limit check`,
      );
      return;
    }

    const now = Date.now();
    const windowMs = windowSeconds * 1000;

    // Get or create rate limit entry
    let entry = this.rateLimitStore.get(key);

    if (!entry || now - entry.windowStart >= windowMs) {
      // Start new window
      entry = {
        count: 1,
        windowStart: now,
        windowMs,
      };
      this.rateLimitStore.set(key, entry);
      this.checkAndEnforceMaxEntries();
      this.logger.debug(`Rate limit: New window started for key '${key}'`);
      return;
    }

    // Increment count in current window
    entry.count++;

    if (entry.count > limit) {
      const retryAfter = Math.ceil((entry.windowStart + windowMs - now) / 1000);
      this.logger.debug(
        `Rate limit exceeded for key '${key}': ${entry.count}/${limit} (retry after ${retryAfter}s)`,
      );
      throw new RateLimitError(
        `Rate limit exceeded. Maximum ${limit} requests per ${windowSeconds} seconds.`,
        retryAfter,
      );
    }

    this.logger.debug(`Rate limit: ${entry.count}/${limit} requests for key '${key}'`);
  }

  /**
   * Generate a unique key for rate limiting.
   * Includes pipeline ID and config values to ensure isolation between:
   * - Different pipelines
   * - Different rate limit configs on the same pipeline
   */
  private generateKey(context: PipelineContext, config: RateLimitValidatorConfig): string | null {
    const { limit, windowSeconds, keyBy = 'ip' } = config;
    const pipelineId = context.pipelineId;
    const ip = context.metadata.ip || 'unknown';
    const userId = context.user?.id;

    // Config prefix ensures different validators have separate counters
    const configPrefix = `${pipelineId}:${limit}:${windowSeconds}:${keyBy}`;

    switch (keyBy) {
      case 'ip':
        return `${configPrefix}:ip:${ip}`;

      case 'user':
        if (!userId) {
          return null; // Can't rate limit by user if not authenticated
        }
        return `${configPrefix}:user:${userId}`;

      case 'ip+user':
        if (!userId) {
          // Fall back to IP only if user not authenticated
          return `${configPrefix}:ip:${ip}`;
        }
        return `${configPrefix}:ip+user:${ip}:${userId}`;

      default:
        return `${configPrefix}:ip:${ip}`;
    }
  }

  /**
   * Clean up expired rate limit entries.
   * Uses each entry's stored windowMs for accurate expiration.
   */
  private cleanupExpiredEntries(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.rateLimitStore.entries()) {
      // Entry is expired if current time is past windowStart + windowMs
      if (now - entry.windowStart >= entry.windowMs) {
        this.rateLimitStore.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug(
        `Cleaned up ${cleaned} expired rate limit entries (${this.rateLimitStore.size} remaining)`,
      );
    }
  }

  /**
   * Enforce maximum entries to prevent unbounded memory growth.
   * If exceeded, removes oldest entries first.
   */
  private checkAndEnforceMaxEntries(): void {
    if (this.rateLimitStore.size <= this.MAX_ENTRIES) {
      return;
    }

    this.logger.warn(
      `Rate limit store exceeded max entries (${this.MAX_ENTRIES}), removing oldest entries`,
    );

    // Convert to array, sort by windowStart, remove oldest 10%
    const entries = Array.from(this.rateLimitStore.entries());
    entries.sort((a, b) => a[1].windowStart - b[1].windowStart);

    const toRemove = Math.ceil(entries.length * 0.1);
    for (let i = 0; i < toRemove; i++) {
      this.rateLimitStore.delete(entries[i][0]);
    }

    this.logger.warn(`Removed ${toRemove} oldest rate limit entries`);
  }

  /**
   * Get current rate limit status for a key (useful for testing/debugging)
   */
  getRateLimitStatus(
    context: PipelineContext,
    config: RateLimitValidatorConfig,
  ): { count: number; windowStart: number; windowMs: number } | null {
    const key = this.generateKey(context, config);
    if (!key) return null;
    return this.rateLimitStore.get(key) || null;
  }

  /**
   * Reset rate limit for a key (useful for testing)
   */
  resetRateLimit(context: PipelineContext, config: RateLimitValidatorConfig): void {
    const key = this.generateKey(context, config);
    if (key) {
      this.rateLimitStore.delete(key);
    }
  }

  /**
   * Get current store size (useful for monitoring)
   */
  getStoreSize(): number {
    return this.rateLimitStore.size;
  }
}
