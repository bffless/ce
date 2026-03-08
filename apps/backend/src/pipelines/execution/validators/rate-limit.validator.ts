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
}

/**
 * Rate Limit Validator
 *
 * Limits the number of requests to a pipeline within a time window.
 * Uses in-memory storage (can be swapped to Redis for distributed systems).
 */
@Injectable()
export class RateLimitValidator implements Validator<RateLimitValidatorConfig> {
  readonly type = 'rate_limit' as const;
  private readonly logger = new Logger(RateLimitValidator.name);

  // In-memory rate limit store
  // Key format: "pipelineId:keyByValue"
  private readonly rateLimitStore = new Map<string, RateLimitEntry>();

  // Cleanup interval for expired entries (every 5 minutes)
  private readonly cleanupInterval: ReturnType<typeof setInterval>;

  constructor(private readonly registry: ValidatorRegistry) {
    this.registry.register(this);

    // Start cleanup interval
    this.cleanupInterval = setInterval(() => this.cleanupExpiredEntries(), 5 * 60 * 1000);
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

    // Generate the rate limit key
    const key = this.generateKey(context, keyBy);

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
      };
      this.rateLimitStore.set(key, entry);
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
   * Generate a unique key for rate limiting based on the keyBy configuration
   */
  private generateKey(context: PipelineContext, keyBy: 'ip' | 'user' | 'ip+user'): string | null {
    const projectId = context.projectId;
    const ip = context.metadata.ip || 'unknown';
    const userId = context.user?.id;

    switch (keyBy) {
      case 'ip':
        return `${projectId}:ip:${ip}`;

      case 'user':
        if (!userId) {
          return null; // Can't rate limit by user if not authenticated
        }
        return `${projectId}:user:${userId}`;

      case 'ip+user':
        if (!userId) {
          // Fall back to IP only if user not authenticated
          return `${projectId}:ip:${ip}`;
        }
        return `${projectId}:ip+user:${ip}:${userId}`;

      default:
        return `${projectId}:ip:${ip}`;
    }
  }

  /**
   * Clean up expired rate limit entries
   */
  private cleanupExpiredEntries(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.rateLimitStore.entries()) {
      // Assume max window of 1 hour for cleanup purposes
      // Entries older than 1 hour are definitely expired
      if (now - entry.windowStart > 60 * 60 * 1000) {
        this.rateLimitStore.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug(`Cleaned up ${cleaned} expired rate limit entries`);
    }
  }

  /**
   * Get current rate limit status for a key (useful for testing/debugging)
   */
  getRateLimitStatus(
    context: PipelineContext,
    keyBy: 'ip' | 'user' | 'ip+user' = 'ip',
  ): { count: number; windowStart: number } | null {
    const key = this.generateKey(context, keyBy);
    if (!key) return null;
    return this.rateLimitStore.get(key) || null;
  }

  /**
   * Reset rate limit for a key (useful for testing)
   */
  resetRateLimit(context: PipelineContext, keyBy: 'ip' | 'user' | 'ip+user' = 'ip'): void {
    const key = this.generateKey(context, keyBy);
    if (key) {
      this.rateLimitStore.delete(key);
    }
  }
}
