import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import picomatch from 'picomatch';
import { ResponseHeaderRulesService } from './response-header-rules.service';
import { ResponseHeaderRule } from '../db/schema';

/**
 * Resolved response header configuration for a specific request path.
 */
export interface ResponseHeaderConfig {
  /** Frame embedding policy */
  framePolicy: 'sameorigin' | 'allow' | 'deny';
  /** Origins allowed to iframe (when framePolicy is 'allow') */
  allowedOrigins: string[];
  /** Custom headers to set (value null = remove header) */
  customHeaders: Record<string, string | null> | null;
  /** Source: 'rule' = matched a rule, 'default' = no rule matched */
  source: 'rule' | 'default';
  /** The rule that matched (for debugging) */
  matchedRule?: ResponseHeaderRule;
}

interface CachedRules {
  rules: ResponseHeaderRule[];
  matchers: picomatch.Matcher[];
  cachedAt: number;
}

// Cache TTL for rule lookups (5 minutes)
const RULE_CACHE_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class ResponseHeaderConfigService {
  private readonly logger = new Logger(ResponseHeaderConfigService.name);
  private ruleCache = new Map<string, CachedRules>();
  private readonly defaultFrameAncestors: string[];

  constructor(
    @Inject(forwardRef(() => ResponseHeaderRulesService))
    private readonly responseHeaderRulesService: ResponseHeaderRulesService,
    private readonly configService: ConfigService,
  ) {
    // Build default frame ancestors from env (same as SecurityHeadersMiddleware)
    const ancestors: string[] = ["'self'"];
    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || '';
    const adminDomain = this.configService.get<string>('ADMIN_DOMAIN') || '';
    const primaryDomain = this.configService.get<string>('PRIMARY_DOMAIN') || '';

    if (frontendUrl) ancestors.push(frontendUrl);
    if (adminDomain) {
      if (!adminDomain.startsWith('http')) {
        ancestors.push(`https://${adminDomain}`, `http://${adminDomain}`);
      } else {
        ancestors.push(adminDomain);
      }
    }
    if (primaryDomain) {
      ancestors.push(`https://*.${primaryDomain}`, `https://${primaryDomain}`);
    }
    this.defaultFrameAncestors = ancestors;
  }

  /**
   * Get response header configuration for a specific file path.
   * Evaluates rules in priority order; first match wins.
   * Returns null if no rule matches (use default behavior).
   */
  async getHeaderConfig(
    projectId: string,
    filePath: string,
  ): Promise<ResponseHeaderConfig | null> {
    let cached = this.ruleCache.get(projectId);
    const now = Date.now();

    if (!cached || now - cached.cachedAt > RULE_CACHE_TTL_MS) {
      const rules =
        await this.responseHeaderRulesService.getEnabledRulesByProjectId(projectId);
      const matchers = rules.map((r) => picomatch(r.pathPattern));
      cached = { rules, matchers, cachedAt: now };
      this.ruleCache.set(projectId, cached);
    }

    // No rules configured — return null (use defaults)
    if (cached.rules.length === 0) return null;

    const normalizedPath = filePath.replace(/^\/+/, '');

    for (let i = 0; i < cached.rules.length; i++) {
      if (cached.matchers[i](normalizedPath)) {
        const rule = cached.rules[i];
        return {
          framePolicy: rule.framePolicy as 'sameorigin' | 'allow' | 'deny',
          allowedOrigins: (rule.allowedOrigins as string[]) || [],
          customHeaders: rule.customHeaders as Record<string, string | null> | null,
          source: 'rule',
          matchedRule: rule,
        };
      }
    }

    return null;
  }

  /**
   * Apply response header configuration to a response.
   * Call this from the public controller when serving content.
   */
  applyHeaders(
    res: { setHeader: (name: string, value: string) => void; removeHeader: (name: string) => void },
    config: ResponseHeaderConfig,
  ): void {
    // Apply frame policy
    switch (config.framePolicy) {
      case 'allow': {
        // Merge custom allowed origins with default ancestors (admin panel, etc.)
        const allOrigins = new Set([
          ...this.defaultFrameAncestors,
          ...config.allowedOrigins,
        ]);
        res.setHeader(
          'Content-Security-Policy',
          `frame-ancestors ${[...allOrigins].join(' ')}`,
        );
        // Remove X-Frame-Options since CSP frame-ancestors takes precedence
        res.removeHeader('X-Frame-Options');
        break;
      }
      case 'deny':
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
        break;
      case 'sameorigin':
      default:
        // Use default frame-ancestors (includes admin panel origins)
        res.setHeader(
          'Content-Security-Policy',
          `frame-ancestors ${this.defaultFrameAncestors.join(' ')}`,
        );
        break;
    }

    // Apply custom headers
    if (config.customHeaders) {
      for (const [name, value] of Object.entries(config.customHeaders)) {
        if (value === null) {
          res.removeHeader(name);
        } else {
          res.setHeader(name, value);
        }
      }
    }
  }

  invalidateProjectCache(projectId: string): void {
    this.ruleCache.delete(projectId);
    this.logger.debug(
      `Invalidated response header rule cache for project ${projectId}`,
    );
  }

  clearAllCache(): void {
    this.ruleCache.clear();
  }
}
