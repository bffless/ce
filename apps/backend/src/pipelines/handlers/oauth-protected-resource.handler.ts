import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { StepHandler, OAuthProtectedResourceConfig } from '../execution/step-handler.interface';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { PipelineContext, StepResult } from '../execution/pipeline-context.interface';
import { PipelineStep, SCOPE_PATTERN } from '../types';
import { ConfigurationError } from '../errors';
import { RuleInvokerService } from '../../proxy-rules/rule-invoker.service';
import { OAuthService } from '../../oauth/oauth.service';
import {
  PROTECTED_RESOURCE_HANDLER,
  protectedResourceDocument,
  protectedResourceSuffix,
  suffixNamesResource,
} from '../mcp/protected-resource';

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const CACHE_CONTROL = 'public, max-age=300';

/**
 * OAuth protected-resource handler (RFC 9728)
 *
 * One step that answers `GET /.well-known/oauth-protected-resource*` with the
 * discovery document for the `mcp_handler` at `resource`, so an app ships no
 * discovery code: `resource` is `https://<host><resource>` from the request,
 * `authorization_servers` is this instance's real issuer (`OAuthService`, never
 * a guess at `admin.<parent>`), `scopes_supported` is declared or derived from
 * the MCP rule's siblings. The document is read before a client has any
 * credential, so a rule carrying this step is served regardless of deployment
 * visibility — the middleware treats it as `bypassVisibility` (#760).
 */
@Injectable()
export class OAuthProtectedResourceHandler implements StepHandler<OAuthProtectedResourceConfig> {
  readonly type = PROTECTED_RESOURCE_HANDLER;

  constructor(
    private readonly registry: StepHandlerRegistry,
    @Inject(forwardRef(() => RuleInvokerService))
    private readonly invoker: RuleInvokerService,
    @Inject(forwardRef(() => OAuthService))
    private readonly oauth: OAuthService,
  ) {
    this.registry.register(this);
  }

  validateConfig(config: OAuthProtectedResourceConfig): void {
    const fail = (message: string): never => {
      throw new ConfigurationError(message, PROTECTED_RESOURCE_HANDLER);
    };
    if (typeof config.resource !== 'string' || !config.resource.startsWith('/'))
      fail('resource must be a path on this host starting with /, e.g. /api/mcp');
    if (config.resource.includes('*') || /[?#\s]/.test(config.resource))
      fail('resource must be a literal path: no wildcard, query or fragment');
    if (config.scopes !== undefined) {
      if (!Array.isArray(config.scopes)) fail('scopes must be an array of strings');
      for (const scope of config.scopes) {
        if (typeof scope !== 'string' || !SCOPE_PATTERN.test(scope))
          fail(`scope ${JSON.stringify(scope)} must be namespace:verb`);
      }
    }
    if (config.resourceName !== undefined && typeof config.resourceName !== 'string')
      fail('resourceName must be a string');
    if (config.resourceDocumentation !== undefined) {
      if (typeof config.resourceDocumentation !== 'string')
        fail('resourceDocumentation must be a URL');
      try {
        new URL(config.resourceDocumentation);
      } catch {
        fail('resourceDocumentation must be a URL');
      }
    }
  }

  async execute(context: PipelineContext, step: PipelineStep): Promise<StepResult> {
    const config = step.config as OAuthProtectedResourceConfig;
    const headers = context.metadata.headers;
    const host = firstHeader(headers['x-forwarded-host']) ?? firstHeader(headers.host);
    if (!host) {
      return terminal(400, { error: 'no_host', message: 'the request names no host' });
    }

    // RFC 9728 §3: a client looks the resource up at the path-suffixed form first;
    // a suffix that names another path is not this document.
    const requestPath = firstHeader(headers['x-original-uri']) ?? context.metadata.path ?? '';
    const suffix = protectedResourceSuffix(requestPath);
    if (!suffixNamesResource(suffix, config.resource)) {
      return terminal(404, {
        error: 'not_found',
        message: `no protected resource at ${suffix}; this host publishes ${config.resource}`,
      });
    }

    // The alias's effective rules are only needed for what the config leaves out.
    const rules =
      Array.isArray(config.scopes) && config.resourceName
        ? []
        : await this.invoker.effectiveRules(context.projectId, context.deployment?.alias);

    const doc = protectedResourceDocument({ host, issuer: this.oauth.issuer(), config, rules });
    return {
      success: true,
      terminates: true,
      output: {
        status: 200,
        body: JSON.stringify(doc),
        headers: { ...JSON_HEADERS, 'Cache-Control': CACHE_CONTROL },
      },
    };
  }
}

function terminal(status: number, body: Record<string, unknown>): StepResult {
  return {
    success: true,
    terminates: true,
    output: { status, body: JSON.stringify(body), headers: { ...JSON_HEADERS } },
  };
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' && first !== '' ? first.split(',')[0].trim() : undefined;
}
