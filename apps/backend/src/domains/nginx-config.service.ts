import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Handlebars from 'handlebars';
import { readFile, writeFile, unlink, access } from 'fs/promises';
import { join } from 'path';
import { DomainMapping, AuthTransformConfig } from '../db/schema';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';

/**
 * Proxy rule with auth transformation for nginx-level rendering.
 * When authTransform is set, the rule is rendered as an nginx location block
 * instead of being handled by backend middleware.
 */
export interface NginxProxyRule {
  pathPattern: string;
  targetUrl: string;
  stripPrefix: boolean;
  timeout: number;
  authTransform: AuthTransformConfig;
  description?: string;
}

/**
 * Config for generating primary domain nginx config via domain mapping.
 * Includes proxy rules support (fixing the bug where proxy rules were not rendered).
 */
export interface PrimaryDomainConfig {
  id: string;
  owner: string;
  repo: string;
  alias: string;
  path: string;
  /** null means www is disabled - only serve root domain */
  wwwBehavior: 'redirect-to-www' | 'redirect-to-root' | 'serve-both' | null;
  isSpa: boolean;
  proxyRules?: NginxProxyRule[];
}

export interface RedirectConfigData {
  sourceDomain: string;
  targetDomain: string;
  redirectType: '301' | '302';
  sslEnabled: boolean;
  isActive: boolean;
}

/**
 * Config for generating redirect domain nginx config.
 * Used for domain mappings with domainType='redirect'.
 * Redirects all traffic to another domain (cross-domain redirect).
 */
export interface RedirectDomainConfig {
  id: string;
  domain: string;
  redirectTarget: string;
  sslEnabled: boolean;
}

/**
 * Path redirect for nginx-level rendering.
 * Handles path-level redirects within a domain (e.g., /old-page -> /new-page).
 */
export interface NginxPathRedirect {
  sourcePath: string;
  targetPath: string;
  redirectType: '301' | '302';
  priority: string;
}

interface Project {
  owner: string;
  name: string;
}

interface TemplateContext {
  id: string;
  domain: string;
  baseDomain: string;
  project: {
    owner: string;
    name: string;
  };
  alias: string;
  path: string;
  sslEnabled: boolean;
  isSpa: boolean;
  backendHost: string;
  backendPort: string;
  listenPort: string;
  createdAt: string;
}

interface RedirectTemplateContext {
  sourceDomain: string;
  targetDomain: string;
  redirectType: '301' | '302';
  sslEnabled: boolean;
  sslCertPath?: string;
  sslKeyPath?: string;
  protocol: 'http' | 'https';
  listenPort: string;
  createdAt: string;
}

@Injectable()
export class NginxConfigService implements OnModuleInit {
  private readonly logger = new Logger(NginxConfigService.name);
  private subdomainTemplate: Handlebars.TemplateDelegate<TemplateContext>;
  private customDomainTemplate: Handlebars.TemplateDelegate<TemplateContext>;
  private redirectTemplate: Handlebars.TemplateDelegate<RedirectTemplateContext>;

  constructor(
    private readonly featureFlagsService: FeatureFlagsService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    await this.loadTemplates();
  }

  private async loadTemplates() {
    try {
      // Load subdomain template
      const subdomainTplPath = join(process.cwd(), 'templates/nginx/subdomain.conf.hbs');
      const subdomainTpl = await readFile(subdomainTplPath, 'utf-8');
      this.subdomainTemplate = Handlebars.compile<TemplateContext>(subdomainTpl);
      this.logger.log('Loaded subdomain template');

      // Load custom domain template
      const customDomainTplPath = join(process.cwd(), 'templates/nginx/custom-domain.conf.hbs');
      const customDomainTpl = await readFile(customDomainTplPath, 'utf-8');
      this.customDomainTemplate = Handlebars.compile<TemplateContext>(customDomainTpl);
      this.logger.log('Loaded custom domain template');

      // Load redirect template
      const redirectTplPath = join(process.cwd(), 'templates/nginx/redirect.conf.hbs');
      const redirectTpl = await readFile(redirectTplPath, 'utf-8');
      this.redirectTemplate = Handlebars.compile<RedirectTemplateContext>(redirectTpl);
      this.logger.log('Loaded redirect template');
    } catch (error) {
      this.logger.error('Failed to load nginx templates', error);
      throw error;
    }
  }

  async generateConfig(
    domainMapping: DomainMapping,
    project: Project,
    proxyRules?: NginxProxyRule[],
    pathRedirects?: NginxPathRedirect[],
  ): Promise<string> {
    // Determine if SSL should be enabled
    // For subdomains, check ENABLE_WILDCARD_SSL flag - if false (PaaS mode where Traefik handles SSL),
    // force sslEnabled to false so nginx doesn't try to load wildcard certs
    let sslEnabled = domainMapping.sslEnabled;
    if (domainMapping.domainType === 'subdomain') {
      const wildcardSslEnabled = await this.featureFlagsService.isEnabled('ENABLE_WILDCARD_SSL');
      if (!wildcardSslEnabled) {
        sslEnabled = false;
        this.logger.debug(
          `Subdomain ${domainMapping.domain}: SSL disabled (ENABLE_WILDCARD_SSL=false, Traefik handles SSL)`,
        );
      }
    }

    // In PLATFORM_MODE, custom domains use a simplified config (port 80 only, Traefik handles SSL)
    if (domainMapping.domainType === 'custom' && this.isPlatformMode()) {
      return this.generatePlatformCustomDomainConfig(
        domainMapping,
        project,
        proxyRules,
        pathRedirects,
      );
    }

    // In PLATFORM_MODE, subdomains also use simplified config
    if (domainMapping.domainType === 'subdomain' && this.isPlatformMode()) {
      return this.generatePlatformSubdomainConfig(
        domainMapping,
        project,
        proxyRules,
        pathRedirects,
      );
    }

    const template =
      domainMapping.domainType === 'subdomain' ? this.subdomainTemplate : this.customDomainTemplate;

    const context: TemplateContext = {
      id: domainMapping.id,
      domain: domainMapping.domain,
      baseDomain: this.getBaseDomain(),
      project: {
        owner: project.owner,
        name: project.name,
      },
      alias: domainMapping.alias || 'latest',
      path: domainMapping.path || '',
      sslEnabled,
      isSpa: domainMapping.isSpa,
      backendHost: this.getBackendHost(),
      backendPort: this.getBackendPort(),
      listenPort: this.getNginxListenPort(),
      createdAt: domainMapping.createdAt.toISOString(),
    };

    let config = template(context);

    // Inject path redirects and proxy rules into the generated config
    // These need to be inserted before the main `location /` block
    const pathRedirectLocations = this.generatePathRedirectLocationBlocks(pathRedirects);
    const proxyLocations = this.generateProxyLocationBlocks(proxyRules);

    if (pathRedirectLocations || proxyLocations) {
      // Find the main `location /` block and insert path redirects before it
      // The regex matches "    location / {" with optional whitespace variations
      const locationMainRegex = /(\n)([ \t]*)(location \/ \{)/;
      const insertContent = `${pathRedirectLocations}${proxyLocations}\n`;
      config = config.replace(locationMainRegex, `$1${insertContent}$2$3`);
    }

    return config;
  }

  /**
   * Generate nginx location blocks for proxy rules with authTransform.
   * These are rendered before the main location / block to take precedence.
   */
  private generateProxyLocationBlocks(proxyRules?: NginxProxyRule[]): string {
    if (!proxyRules || proxyRules.length === 0) {
      return '';
    }

    return proxyRules
      .map((rule) => {
        // Convert pathPattern to nginx location
        // /api/platform/* -> /api/platform/
        const locationPath = rule.pathPattern.replace(/\*$/, '');

        // Parse target URL
        const targetUrl = new URL(rule.targetUrl);
        const proxyPass = `${targetUrl.protocol}//${targetUrl.host}`;

        // Generate rewrite rule if stripPrefix is true
        // /api/platform/workspaces -> /api/workspaces (strip /api/platform prefix)
        let rewriteRule = '';
        if (rule.stripPrefix && locationPath !== '/') {
          const strippedPath = locationPath.replace(/\/$/, '');
          // Rewrite: ^/api/platform/(.*)$ /api/$1 break;
          // If target has a path, prepend it
          const targetPath = targetUrl.pathname === '/' ? '' : targetUrl.pathname;
          rewriteRule = `rewrite ^${strippedPath}/(.*)$ ${targetPath}/$1 break;`;
        }

        // Generate auth transformation header
        let authHeader = '';
        if (rule.authTransform?.type === 'cookie-to-bearer') {
          const cookieName = rule.authTransform.cookieName;
          authHeader = `proxy_set_header Authorization "Bearer $cookie_${cookieName}";`;
        }

        const description = rule.description ? `# ${rule.description}\n    ` : '';
        const timeout = rule.timeout || 60;

        return `
    ${description}# Proxy rule: ${rule.pathPattern} -> ${rule.targetUrl}
    location ${locationPath} {
        ${rewriteRule}

        proxy_pass ${proxyPass};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
        ${authHeader}

        proxy_connect_timeout ${timeout}s;
        proxy_send_timeout ${timeout}s;
        proxy_read_timeout ${timeout}s;
    }`;
      })
      .join('\n');
  }

  /**
   * Generate nginx location blocks for path redirects.
   * These are rendered before the main location block to take precedence.
   * Supports exact match (/old-page) and wildcard patterns (/old-blog/*).
   */
  private generatePathRedirectLocationBlocks(pathRedirects?: NginxPathRedirect[]): string {
    if (!pathRedirects || pathRedirects.length === 0) {
      return '';
    }

    return pathRedirects
      .map((redirect) => {
        const sourcePath = redirect.sourcePath;
        const targetPath = redirect.targetPath;
        const redirectType = redirect.redirectType;

        // Check if it's a wildcard pattern
        if (sourcePath.endsWith('/*')) {
          // Wildcard: /old-blog/* -> /blog/$1
          const sourcePrefix = sourcePath.slice(0, -2); // Remove /*
          // Handle $1 replacement in target path
          const targetHasCapture = targetPath.includes('$1');
          const nginxTarget = targetHasCapture ? targetPath : `${targetPath}$1`;

          return `
    # Path redirect: ${sourcePath} -> ${targetPath}
    location ~ ^${sourcePrefix}/(.*)$ {
        return ${redirectType} ${nginxTarget};
    }`;
        } else {
          // Exact match: /old-page -> /new-page
          return `
    # Path redirect: ${sourcePath} -> ${targetPath}
    location = ${sourcePath} {
        return ${redirectType} ${targetPath};
    }`;
        }
      })
      .join('\n');
  }

  /**
   * Generate nginx config for custom domains in PLATFORM_MODE.
   * Simpler config: port 80 only, no SSL (Traefik handles SSL termination).
   * Handles wwwBehavior for www/apex redirect configurations.
   */
  private generatePlatformCustomDomainConfig(
    domainMapping: DomainMapping,
    project: Project,
    proxyRules?: NginxProxyRule[],
    pathRedirects?: NginxPathRedirect[],
  ): string {
    const backendHost = this.getBackendHost();
    const backendPort = this.getBackendPort();
    const alias = domainMapping.alias || 'latest';
    const pathPrefix = domainMapping.path || '';
    const internalPath = `/public/${project.owner}/${project.name}/alias/${alias}${pathPrefix}`;
    const listenPort = this.getNginxListenPort();

    // Determine www and apex domain variants
    const domain = domainMapping.domain;
    const isWww = domain.startsWith('www.');
    const apexDomain = isWww ? domain.slice(4) : domain;
    const wwwDomain = isWww ? domain : `www.${domain}`;

    // Common blocks used in server configurations
    const securityHeaders = `
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;`;

    const scannerBlock = `
    # Block vulnerability scanners (403 for Traefik compatibility)
    if ($block_scanner) {
        return 403;
    }`;

    const errorPages = `
    # Custom error pages
    error_page 404 /404.html;
    error_page 500 502 503 504 /50x.html;`;

    const healthCheck = `
    # Health check endpoint (used for DNS verification)
    location /.well-known/health {
        access_log off;
        return 200 "OK";
        add_header Content-Type text/plain;
    }`;

    const errorLocations = `
    # Static error pages
    location = /404.html {
        internal;
        root /etc/nginx/error-pages;
    }

    location = /50x.html {
        internal;
        root /etc/nginx/error-pages;
    }`;

    const spaFallback = domainMapping.isSpa
      ? `
    # SPA fallback - serve index.html for client-side routing
    location @spa_fallback {
        rewrite ^/(.*)$ ${internalPath}/index.html break;

        proxy_pass http://${backendHost}:${backendPort};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Original-URI $request_uri;

        proxy_intercept_errors off;
    }`
      : '';

    const spaErrorPage = domainMapping.isSpa ? 'error_page 404 = @spa_fallback;' : '';
    const proxyInterceptErrors = domainMapping.isSpa ? 'on' : 'off';

    // Generate proxy and path redirect location blocks
    const proxyLocations = this.generateProxyLocationBlocks(proxyRules);
    const pathRedirectLocations = this.generatePathRedirectLocationBlocks(pathRedirects);

    // Main content-serving location block
    const mainLocation = `
    # Main location
    location / {
        rewrite ^/(.*)$ ${internalPath}/$1 break;

        proxy_pass http://${backendHost}:${backendPort};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Original-URI $request_uri;

        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;

        proxy_intercept_errors ${proxyInterceptErrors};
        ${spaErrorPage}
    }`;

    // Generate content-serving server block
    const generateContentServerBlock = (serverName: string) => `
server {
    listen ${listenPort};
    server_name ${serverName};
${securityHeaders}
${scannerBlock}
${errorPages}
${healthCheck}
${pathRedirectLocations}${proxyLocations}
${mainLocation}
${spaFallback}
${errorLocations}
}`;

    // Generate redirect server block
    const generateRedirectServerBlock = (sourceDomain: string, targetDomain: string) => `
server {
    listen ${listenPort};
    server_name ${sourceDomain};
${scannerBlock}

    # Health check endpoint
    location /.well-known/health {
        access_log off;
        return 200 "OK";
        add_header Content-Type text/plain;
    }

    # Redirect all traffic to target domain
    location / {
        return 301 https://${targetDomain}$request_uri;
    }
}`;

    // Build comments
    const proxyRulesComment =
      proxyRules && proxyRules.length > 0
        ? `# Proxy Rules: ${proxyRules.length} rule(s) with auth transformation\n`
        : '';
    const pathRedirectsComment =
      pathRedirects && pathRedirects.length > 0
        ? `# Path Redirects: ${pathRedirects.length} redirect(s)\n`
        : '';
    const wwwBehaviorComment = domainMapping.wwwBehavior
      ? `# WWW Behavior: ${domainMapping.wwwBehavior}\n`
      : '';

    let serverBlocks: string;

    if (domainMapping.wwwBehavior === 'redirect-to-www') {
      // Apex redirects to www, www serves content
      serverBlocks = `${generateContentServerBlock(wwwDomain)}
${generateRedirectServerBlock(apexDomain, wwwDomain)}`;
    } else if (domainMapping.wwwBehavior === 'redirect-to-root') {
      // WWW redirects to apex, apex serves content
      serverBlocks = `${generateContentServerBlock(apexDomain)}
${generateRedirectServerBlock(wwwDomain, apexDomain)}`;
    } else if (domainMapping.wwwBehavior === 'serve-both') {
      // Both domains serve the same content
      serverBlocks = generateContentServerBlock(`${apexDomain} ${wwwDomain}`);
    } else {
      // No www behavior - just serve the specified domain
      serverBlocks = generateContentServerBlock(domain);
    }

    return `# Custom Domain Configuration (Platform Mode)
# Generated: ${new Date().toISOString()}
# Domain: ${domainMapping.domain}
# Project: ${project.owner}/${project.name}
# Alias: ${alias}
# Path: ${pathPrefix || '/'}
# SPA Mode: ${domainMapping.isSpa ? 'enabled' : 'disabled'}
${proxyRulesComment}${pathRedirectsComment}${wwwBehaviorComment}# Note: SSL is terminated by Traefik/Cloudflare, nginx listens on port ${listenPort}
${serverBlocks}
`;
  }

  /**
   * Generate nginx config for subdomains in PLATFORM_MODE.
   * Similar to custom domains: port 80 only, Traefik handles SSL.
   */
  private generatePlatformSubdomainConfig(
    domainMapping: DomainMapping,
    project: Project,
    proxyRules?: NginxProxyRule[],
    pathRedirects?: NginxPathRedirect[],
  ): string {
    const backendHost = this.getBackendHost();
    const backendPort = this.getBackendPort();
    const alias = domainMapping.alias || 'latest';
    const pathPrefix = domainMapping.path || '';
    const internalPath = `/public/${project.owner}/${project.name}/alias/${alias}${pathPrefix}`;

    const spaFallback = domainMapping.isSpa
      ? `
    # SPA fallback - serve index.html for client-side routing
    location @spa_fallback {
        rewrite ^/(.*)$ ${internalPath}/index.html break;

        proxy_pass http://${backendHost}:${backendPort};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Original-URI $request_uri;

        proxy_intercept_errors off;
    }`
      : '';

    const spaErrorPage = domainMapping.isSpa ? 'error_page 404 = @spa_fallback;' : '';

    // SPA mode: intercept errors to try index.html fallback
    // Non-SPA mode: let backend's styled 404 page pass through directly
    const proxyInterceptErrors = domainMapping.isSpa ? 'on' : 'off';

    // Generate proxy location blocks for rules with authTransform
    const proxyLocations = this.generateProxyLocationBlocks(proxyRules);
    const proxyRulesComment =
      proxyRules && proxyRules.length > 0
        ? `# Proxy Rules: ${proxyRules.length} rule(s) with auth transformation\n`
        : '';

    // Generate path redirect location blocks
    const pathRedirectLocations = this.generatePathRedirectLocationBlocks(pathRedirects);
    const pathRedirectsComment =
      pathRedirects && pathRedirects.length > 0
        ? `# Path Redirects: ${pathRedirects.length} redirect(s)\n`
        : '';

    return `# Subdomain Configuration (Platform Mode)
# Generated: ${new Date().toISOString()}
# Domain: ${domainMapping.domain}
# Project: ${project.owner}/${project.name}
# Alias: ${alias}
# Path: ${pathPrefix || '/'}
# SPA Mode: ${domainMapping.isSpa ? 'enabled' : 'disabled'}
${proxyRulesComment}${pathRedirectsComment}# Note: SSL is terminated by Traefik, nginx listens on port 80

server {
    listen ${this.getNginxListenPort()};
    server_name ${domainMapping.domain};

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;

    # Block vulnerability scanners (403 for Traefik compatibility)
    if ($block_scanner) {
        return 403;
    }

    # Custom error pages
    error_page 404 /404.html;
    error_page 500 502 503 504 /50x.html;

    # Health check endpoint
    location /.well-known/health {
        access_log off;
        return 200 "OK";
        add_header Content-Type text/plain;
    }
${pathRedirectLocations}${proxyLocations}

    # Main location
    location / {
        rewrite ^/(.*)$ ${internalPath}/$1 break;

        proxy_pass http://${backendHost}:${backendPort};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Original-URI $request_uri;

        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;

        proxy_intercept_errors ${proxyInterceptErrors};
        ${spaErrorPage}
    }
${spaFallback}

    # Static error pages
    location = /404.html {
        internal;
        root /etc/nginx/error-pages;
    }

    location = /50x.html {
        internal;
        root /etc/nginx/error-pages;
    }
}
`;
  }

  async writeConfigFile(
    domainMappingId: string,
    config: string,
  ): Promise<{ tempPath: string; finalPath: string }> {
    const filename = `domain-${domainMappingId}.conf`;
    const tempPath = join('/tmp', filename);
    const finalPath = join(this.getNginxSitesPath(), filename);

    // Write to temp file
    await writeFile(tempPath, config, 'utf-8');
    this.logger.log(`Wrote nginx config to temp file: ${tempPath}`);

    return { tempPath, finalPath };
  }

  async deleteConfigFile(nginxConfigPath: string): Promise<void> {
    try {
      await access(nginxConfigPath);
      await unlink(nginxConfigPath);
      this.logger.log(`Deleted nginx config: ${nginxConfigPath}`);
    } catch {
      this.logger.warn(`Config file not found: ${nginxConfigPath}`);
    }
  }

  getConfigFilePath(domainMappingId: string): string {
    const filename = `domain-${domainMappingId}.conf`;
    return join(this.getNginxSitesPath(), filename);
  }

  private getBaseDomain(): string {
    return process.env.PRIMARY_DOMAIN || 'localhost';
  }

  private getBackendHost(): string {
    return process.env.BACKEND_HOST || 'localhost';
  }

  private getBackendPort(): string {
    return process.env.BACKEND_PORT || '3000';
  }

  private getNginxListenPort(): string {
    return process.env.NGINX_LISTEN_PORT || '80';
  }

  private isPlatformMode(): boolean {
    return process.env.PLATFORM_MODE === 'true';
  }

  /**
   * Check if an external proxy fully terminates SSL.
   * When PROXY_MODE=cloudflare-tunnel, nginx should generate non-SSL configs (port 80 only)
   * since Cloudflare Tunnel handles HTTPS termination.
   *
   * Note: PROXY_MODE=cloudflare is different - it uses Cloudflare origin certs
   * and nginx still listens on 443.
   */
  private isExternalSslProxy(): boolean {
    const proxyMode = this.configService.get<string>('PROXY_MODE', 'none');
    return proxyMode === 'cloudflare-tunnel';
  }

  /**
   * Check if nginx should handle SSL directly.
   * Returns false when:
   * - PLATFORM_MODE=true (Traefik handles SSL)
   * - PROXY_MODE=cloudflare-tunnel (Cloudflare Tunnel handles SSL)
   */
  private shouldNginxHandleSsl(): boolean {
    return !this.isPlatformMode() && !this.isExternalSslProxy();
  }

  private getAdminDomain(): string {
    return process.env.ADMIN_DOMAIN || `admin.${this.getBaseDomain()}`;
  }

  /**
   * Get the nginx sites path (where config files are written).
   * In dev: local directory for testing
   * In prod: /etc/nginx/sites-enabled
   */
  getNginxSitesPath(): string {
    return process.env.NGINX_SITES_PATH || '/etc/nginx/sites-enabled';
  }

  // =====================
  // Redirect Domain Methods
  // =====================

  /**
   * Generate nginx config for a redirect domain.
   * This redirects all traffic from one domain to another domain.
   * Used when a domain mapping has domainType='redirect'.
   */
  generateRedirectDomainConfig(config: RedirectDomainConfig): string {
    // Check if nginx should handle SSL directly
    // When false: PLATFORM_MODE=true (Traefik) or PROXY_MODE=cloudflare (external proxy)
    if (this.shouldNginxHandleSsl()) {
      return this.generateCERedirectDomainConfig(config);
    }
    return this.generatePlatformRedirectDomainConfig(config);
  }

  /**
   * Platform mode: Traefik handles SSL, nginx listens on port 80.
   * Returns a 301 redirect to the target domain.
   */
  private generatePlatformRedirectDomainConfig(config: RedirectDomainConfig): string {
    return `# Redirect Domain Configuration (Platform Mode)
# Generated: ${new Date().toISOString()}
# Domain: ${config.domain}
# Redirect Target: ${config.redirectTarget}
# Note: SSL is terminated by Traefik, nginx listens on port 80

server {
    listen ${this.getNginxListenPort()};
    server_name ${config.domain};

    # Block vulnerability scanners (403 for Traefik compatibility)
    if ($block_scanner) {
        return 403;
    }

    # Health check endpoint (used for DNS verification)
    location /.well-known/health {
        access_log off;
        return 200 "OK";
        add_header Content-Type text/plain;
    }

    # Redirect all traffic to target domain
    location / {
        return 301 https://${config.redirectTarget}$request_uri;
    }
}
`;
  }

  /**
   * CE mode: nginx handles SSL directly.
   * For redirect domains without SSL, only listen on port 80.
   * For redirect domains with SSL, also listen on port 443.
   */
  private generateCERedirectDomainConfig(config: RedirectDomainConfig): string {
    const sslCertPath = config.sslEnabled ? this.getSslCertPathForDomain(config.domain) : '';
    const sslKeyPath = config.sslEnabled ? this.getSslKeyPathForDomain(config.domain) : '';

    const httpServerBlock = `
server {
    listen ${this.getNginxListenPort()};
    server_name ${config.domain};

    # Block vulnerability scanners
    if ($block_scanner) {
        return 444;
    }

    # Health check endpoint
    location /.well-known/health {
        access_log off;
        return 200 "OK";
        add_header Content-Type text/plain;
    }

    # Redirect all traffic to target domain (HTTPS)
    location / {
        return 301 https://${config.redirectTarget}$request_uri;
    }
}`;

    const httpsServerBlock = config.sslEnabled
      ? `

server {
    listen 443 ssl;
    http2 on;
    server_name ${config.domain};

    ssl_certificate ${sslCertPath};
    ssl_certificate_key ${sslKeyPath};
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Block vulnerability scanners
    if ($block_scanner) {
        return 444;
    }

    # Redirect all traffic to target domain (HTTPS)
    location / {
        return 301 https://${config.redirectTarget}$request_uri;
    }
}`
      : '';

    return `# Redirect Domain Configuration (CE Mode)
# Generated: ${new Date().toISOString()}
# Domain: ${config.domain}
# Redirect Target: ${config.redirectTarget}
# SSL Enabled: ${config.sslEnabled}
${httpServerBlock}${httpsServerBlock}
`;
  }

  /**
   * Get SSL certificate path for a specific domain.
   */
  private getSslCertPathForDomain(domain: string): string {
    return `/etc/nginx/ssl/${domain}/fullchain.pem`;
  }

  /**
   * Get SSL key path for a specific domain.
   */
  private getSslKeyPathForDomain(domain: string): string {
    return `/etc/nginx/ssl/${domain}/privkey.pem`;
  }

  // =====================
  // Primary Domain Methods (via Domain Mapping)
  // =====================

  /**
   * Generate nginx config for a primary domain mapping.
   * This is the unified method that includes proxy rules support.
   * Called when a domain mapping has isPrimary=true.
   */
  async generatePrimaryDomainConfig(
    config: PrimaryDomainConfig,
  ): Promise<{ tempPath: string; finalPath: string }> {
    const baseDomain = this.getBaseDomain();
    // Use domain mapping ID in filename for consistency with other domain mappings
    const filename = `domain-${config.id}.conf`;
    const tempPath = join('/tmp', filename);
    const finalPath = join(this.getNginxSitesPath(), filename);

    // Check if nginx should handle SSL directly
    // When false: PLATFORM_MODE=true (Traefik) or PROXY_MODE=cloudflare (external proxy)
    const nginxConfig = this.shouldNginxHandleSsl()
      ? this.generateCEPrimaryDomainConfig(config, baseDomain)
      : this.generatePlatformPrimaryDomainConfig(config, baseDomain);

    await writeFile(tempPath, nginxConfig, 'utf-8');
    this.logger.log(`Wrote primary domain nginx config to temp file: ${tempPath}`);

    return { tempPath, finalPath };
  }

  /**
   * Platform mode: Traefik handles SSL, nginx listens on port 80.
   * Includes proxy rules as location blocks before main content location.
   */
  private generatePlatformPrimaryDomainConfig(
    config: PrimaryDomainConfig,
    baseDomain: string,
  ): string {
    const internalPath = `/public/${config.owner}/${config.repo}/alias/${config.alias}${config.path}`;
    const backendHost = this.getBackendHost();
    const backendPort = this.getBackendPort();

    // Generate proxy location blocks for rules with authTransform
    const proxyLocations = this.generateProxyLocationBlocks(config.proxyRules);
    const proxyRulesComment =
      config.proxyRules && config.proxyRules.length > 0
        ? `# Proxy Rules: ${config.proxyRules.length} rule(s) with auth transformation\n`
        : '';

    // Security headers (including canonical URL)
    const getSecurityHeaders = (canonicalDomain: string) => `
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Link "<https://${canonicalDomain}$request_uri>; rel=\\"canonical\\"" always;`;

    // Block vulnerability scanners (403 for Traefik compatibility)
    const scannerBlock = `
    # Block vulnerability scanners (403 for Traefik compatibility)
    if ($block_scanner) {
        return 403;
    }`;

    // Error page configuration
    const errorPages = `
    # Custom error pages
    error_page 404 /404.html;
    error_page 500 502 503 504 /50x.html;`;

    // Static error page locations
    const errorLocations = `
    # Static error pages (served from nginx)
    location = /404.html {
        internal;
        root /etc/nginx/error-pages;
    }

    location = /50x.html {
        internal;
        root /etc/nginx/error-pages;
    }`;

    // Location block varies based on SPA mode
    const spaFallback = config.isSpa
      ? `
    # SPA fallback - serve index.html for client-side routing
    location @spa_fallback {
        rewrite ^/(.*)$ ${internalPath}/index.html break;

        proxy_pass http://${backendHost}:${backendPort};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Original-URI $request_uri;

        proxy_intercept_errors off;
    }`
      : '';

    const spaErrorPage = config.isSpa ? 'error_page 404 = @spa_fallback;' : '';
    const proxyInterceptErrors = config.isSpa ? 'on' : 'off';

    // Main location block
    const locationBlock = `
${proxyLocations}

    # Main location - serves static content
    location / {
        rewrite ^/(.*)$ ${internalPath}/$1 break;

        proxy_pass http://${backendHost}:${backendPort};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Original-URI $request_uri;

        proxy_intercept_errors ${proxyInterceptErrors};
        ${spaErrorPage}
    }
${spaFallback}
${errorLocations}`;

    let serverBlocks: string;

    if (config.wwwBehavior === 'redirect-to-www') {
      serverBlocks = `
# Primary Domain - WWW (serves content)
server {
    listen ${this.getNginxListenPort()};
    server_name www.${baseDomain};
${getSecurityHeaders(`www.${baseDomain}`)}
${scannerBlock}
${errorPages}
${locationBlock}
}

# Primary Domain - Root (redirect to www)
server {
    listen ${this.getNginxListenPort()};
    server_name ${baseDomain};
${scannerBlock}

    return 301 https://www.${baseDomain}$request_uri;
}
`;
    } else if (config.wwwBehavior === 'redirect-to-root') {
      serverBlocks = `
# Primary Domain - Root (serves content)
server {
    listen ${this.getNginxListenPort()};
    server_name ${baseDomain};
${getSecurityHeaders(baseDomain)}
${scannerBlock}
${errorPages}
${locationBlock}
}

# Primary Domain - WWW (redirect to root)
server {
    listen ${this.getNginxListenPort()};
    server_name www.${baseDomain};
${scannerBlock}

    return 301 https://${baseDomain}$request_uri;
}
`;
    } else if (config.wwwBehavior === 'serve-both') {
      serverBlocks = `
# Primary Domain - Both domains serve content
server {
    listen ${this.getNginxListenPort()};
    server_name ${baseDomain} www.${baseDomain};
${getSecurityHeaders(`www.${baseDomain}`)}
${scannerBlock}
${errorPages}
${locationBlock}
}
`;
    } else {
      // null - www is disabled, only serve root domain
      serverBlocks = `
# Primary Domain - Root only (www disabled)
server {
    listen ${this.getNginxListenPort()};
    server_name ${baseDomain};
${getSecurityHeaders(baseDomain)}
${scannerBlock}
${errorPages}
${locationBlock}
}
`;
    }

    return `# Primary Domain Configuration (Platform Mode - via Domain Mapping)
# Generated: ${new Date().toISOString()}
# Project: ${config.owner}/${config.repo}
# Alias: ${config.alias}
# Path: ${config.path || '/'}
# WWW Behavior: ${config.wwwBehavior}
# SPA Mode: ${config.isSpa ? 'enabled' : 'disabled'}
${proxyRulesComment}# Note: SSL is terminated by Traefik, nginx listens on port 80
${serverBlocks}`;
  }

  /**
   * CE mode: nginx handles SSL directly on port 443.
   * Includes proxy rules as location blocks before main content location.
   */
  private generateCEPrimaryDomainConfig(config: PrimaryDomainConfig, baseDomain: string): string {
    const internalPath = `/public/${config.owner}/${config.repo}/alias/${config.alias}${config.path}`;
    const backendHost = this.getBackendHost();
    const backendPort = this.getBackendPort();

    // Generate proxy location blocks
    const proxyLocations = this.generateProxyLocationBlocks(config.proxyRules);
    const proxyRulesComment =
      config.proxyRules && config.proxyRules.length > 0
        ? `# Proxy Rules: ${config.proxyRules.length} rule(s) with auth transformation\n`
        : '';

    // Common SSL settings
    const sslSettings = `
    ssl_certificate /etc/nginx/ssl/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;`;

    // Security headers
    const getSecurityHeaders = (canonicalDomain: string) => `
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Link "<https://${canonicalDomain}$request_uri>; rel=\\"canonical\\"" always;`;

    const scannerBlock = `
    # Block vulnerability scanners (drop connection silently)
    if ($block_scanner) {
        return 444;
    }`;

    const errorPages = `
    # Custom error pages
    error_page 404 /404.html;
    error_page 500 502 503 504 /50x.html;`;

    const errorLocations = `
    # Static error pages
    location = /404.html {
        internal;
        root /etc/nginx/error-pages;
    }

    location = /50x.html {
        internal;
        root /etc/nginx/error-pages;
    }`;

    // SPA fallback
    const spaFallback = config.isSpa
      ? `
    # SPA fallback
    location @spa_fallback {
        rewrite ^/(.*)$ ${internalPath}/index.html break;

        proxy_pass http://${backendHost}:${backendPort};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Original-URI $request_uri;

        proxy_intercept_errors on;
        error_page 404 /404.html;
    }`
      : '';

    const spaErrorPage = config.isSpa ? 'error_page 404 = @spa_fallback;' : '';
    const proxyInterceptErrors = config.isSpa ? 'on' : 'off';

    const locationBlock = `
${proxyLocations}

    location / {
        rewrite ^/(.*)$ ${internalPath}/$1 break;

        proxy_pass http://${backendHost}:${backendPort};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Original-URI $request_uri;

        proxy_intercept_errors ${proxyInterceptErrors};
        ${spaErrorPage}
    }
${spaFallback}
${errorLocations}`;

    let serverBlocks: string;

    if (config.wwwBehavior === 'redirect-to-www') {
      serverBlocks = `
# Primary Domain - WWW (serves content)
server {
    listen 443 ssl;
    http2 on;
    server_name www.${baseDomain};
${sslSettings}
${getSecurityHeaders(`www.${baseDomain}`)}
${scannerBlock}
${errorPages}
${locationBlock}
}

# Primary Domain - Root (redirect to www)
server {
    listen 443 ssl;
    http2 on;
    server_name ${baseDomain};
${sslSettings}
${scannerBlock}

    return 301 https://www.${baseDomain}$request_uri;
}
`;
    } else if (config.wwwBehavior === 'redirect-to-root') {
      serverBlocks = `
# Primary Domain - Root (serves content)
server {
    listen 443 ssl;
    http2 on;
    server_name ${baseDomain};
${sslSettings}
${getSecurityHeaders(baseDomain)}
${scannerBlock}
${errorPages}
${locationBlock}
}

# Primary Domain - WWW (redirect to root)
server {
    listen 443 ssl;
    http2 on;
    server_name www.${baseDomain};
${sslSettings}
${scannerBlock}

    return 301 https://${baseDomain}$request_uri;
}
`;
    } else if (config.wwwBehavior === 'serve-both') {
      serverBlocks = `
# Primary Domain - Both serve content
server {
    listen 443 ssl;
    http2 on;
    server_name ${baseDomain} www.${baseDomain};
${sslSettings}
${getSecurityHeaders(`www.${baseDomain}`)}
${scannerBlock}
${errorPages}
${locationBlock}
}
`;
    } else {
      // null - www is disabled, only serve root domain
      serverBlocks = `
# Primary Domain - Root only (www disabled)
server {
    listen 443 ssl;
    http2 on;
    server_name ${baseDomain};
${sslSettings}
${getSecurityHeaders(baseDomain)}
${scannerBlock}
${errorPages}
${locationBlock}
}
`;
    }

    return `# Primary Domain Configuration (CE Mode - via Domain Mapping)
# Generated: ${new Date().toISOString()}
# Project: ${config.owner}/${config.repo}
# Alias: ${config.alias}
# Path: ${config.path || '/'}
# WWW Behavior: ${config.wwwBehavior}
# SPA Mode: ${config.isSpa ? 'enabled' : 'disabled'}
${proxyRulesComment}${serverBlocks}`;
  }

  // =====================
  // Welcome Page Config
  // =====================

  /**
   * Generate a welcome page config for www/root when primary content is disabled
   * This ensures www.{domain} and {domain} always have server blocks
   */
  async generateWelcomePageConfig(): Promise<{ tempPath: string; finalPath: string }> {
    const baseDomain = this.getBaseDomain();
    const filename = 'primary-content.conf';
    const tempPath = join('/tmp', filename);
    const finalPath = join(this.getNginxSitesPath(), filename);

    const nginxConfig = this.generateWelcomePageNginxConfig(baseDomain);

    await writeFile(tempPath, nginxConfig, 'utf-8');
    this.logger.log(`Wrote welcome page nginx config to temp file: ${tempPath}`);

    return { tempPath, finalPath };
  }

  private generateWelcomePageNginxConfig(baseDomain: string): string {
    // Check if nginx should handle SSL directly
    // When false: PLATFORM_MODE=true (Traefik) or PROXY_MODE=cloudflare (external proxy)
    if (this.shouldNginxHandleSsl()) {
      return this.generateCEWelcomePageConfig(baseDomain);
    }
    return this.generatePlatformWelcomePageConfig(baseDomain);
  }

  /**
   * Platform mode: Traefik handles SSL, nginx listens on port 80
   */
  private generatePlatformWelcomePageConfig(baseDomain: string): string {
    const adminDomain = this.getAdminDomain();

    return `# Primary Content Configuration - Welcome Page (Platform Mode)
# Generated: ${new Date().toISOString()}
# Status: Disabled - showing welcome page
# Note: SSL is terminated by Traefik, nginx listens on port 80

server {
    listen ${this.getNginxListenPort()};
    server_name ${baseDomain} www.${baseDomain};

    # Block vulnerability scanners (403 for Traefik compatibility)
    if ($block_scanner) {
        return 403;
    }

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Cache-Hit "none" always;

    location / {
        default_type text/html;
        return 200 '<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome - BFFLESS</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #ede8dd;
            color: #3a3a3a;
        }
        .container {
            text-align: center;
            padding: 2rem;
            max-width: 600px;
        }
        .logo {
            width: 160px;
            height: 160px;
            margin-bottom: 1.5rem;
        }
        h1 {
            font-size: 2.5rem;
            margin-bottom: 0.5rem;
            font-weight: 700;
            color: #3a3a3a;
        }
        p {
            font-size: 1.1rem;
            color: #4a4a4a;
            margin-bottom: 2rem;
            line-height: 1.6;
        }
        .admin-link {
            display: inline-block;
            padding: 0.75rem 2rem;
            background: #d96459;
            color: white;
            text-decoration: none;
            border-radius: 8px;
            font-weight: 600;
            transition: transform 0.2s, box-shadow 0.2s, background 0.2s;
        }
        .admin-link:hover {
            background: #c55449;
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(217, 100, 89, 0.3);
        }
        .footer {
            margin-top: 3rem;
            font-size: 0.875rem;
            color: #4a4a4a;
            opacity: 0.7;
        }
    </style>
</head>
<body>
    <div class="container">
        <img class="logo" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MDAiIGhlaWdodD0iNDAwIiB2aWV3Qm94PSIwIDAgNDAwIDQwMCI+PGcgc3Ryb2tlPSIjNGE0YTRhIiBzdHJva2Utd2lkdGg9IjUiIGZpbGw9Im5vbmUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0iTTExNSAyMTUgTDExNSAyOTUgTDU1IDI5NSBMNTUgMzU1Ii8+PHBhdGggZD0iTTE1NSAyMzUgTDE1NSAzMjAgTDEzMCAzMjAgTDEzMCAzNzAiLz48cGF0aCBkPSJNMjQ1IDIzNSBMMjQ1IDMyMCBMMjcwIDMyMCBMMjcwIDM3MCIvPjxwYXRoIGQ9Ik0yODUgMjE1IEwyODUgMjk1IEwzNDUgMjk1IEwzNDUgMzU1Ii8+PC9nPjxnIGZpbGw9IiM0YTRhNGEiPjxjaXJjbGUgY3g9IjU1IiBjeT0iMzYwIiByPSI4Ii8+PGNpcmNsZSBjeD0iMTMwIiBjeT0iMzc1IiByPSI4Ii8+PGNpcmNsZSBjeD0iMjcwIiBjeT0iMzc1IiByPSI4Ii8+PGNpcmNsZSBjeD0iMzQ1IiBjeT0iMzYwIiByPSI4Ii8+PC9nPjxnIGZpbGw9IndoaXRlIj48Y2lyY2xlIGN4PSI1NSIgY3k9IjM2MCIgcj0iMyIvPjxjaXJjbGUgY3g9IjEzMCIgY3k9IjM3NSIgcj0iMyIvPjxjaXJjbGUgY3g9IjI3MCIgY3k9IjM3NSIgcj0iMyIvPjxjaXJjbGUgY3g9IjM0NSIgY3k9IjM2MCIgcj0iMyIvPjwvZz48cGF0aCBkPSJNMTk1IDg1IEMxOTAgNTUgMTcwIDM1IDE0MCAzNSBDMTAwIDM1IDYwIDYwIDYwIDExMCBDNjAgMjAwIDE1MCAyMzAgMTk1IDI4MCBMMjA1IDI0MCBMMTg1IDIwMCBMMjA1IDE2MCBMMTg1IDEyMCBMMTk1IDg1IFoiIGZpbGw9IiNjOTVjNTQiLz48cGF0aCBkPSJNMjA1IDg1IEMyMTAgNTUgMjMwIDM1IDI2MCAzNSBDMzAwIDM1IDM0MCA2MCAzNDAgMTEwIEMzNDAgMjAwIDI1MCAyMzAgMjA1IDI4MCBMMjE1IDI0MCBMMTk1IDIwMCBMMjE1IDE2MCBMMTk1IDEyMCBMMjA1IDg1IFoiIGZpbGw9IiNjOTVjNTQiLz48cGF0aCBkPSJNMTI1IDYwIEMxMDAgNzIgOTUgMTAwIDExMCAxMjAiIHN0cm9rZT0icmdiYSgyNTUsMjU1LDI1NSwwLjM1KSIgc3Ryb2tlLXdpZHRoPSIxNCIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBmaWxsPSJub25lIiB0cmFuc2Zvcm09InJvdGF0ZSgyMCAxMTAgOTApIi8+PC9zdmc+" alt="BFFLESS"/>
        <h1>Welcome to BFFLESS</h1>
        <p>Primary content has not been configured yet.</p>
        <a href="https://${adminDomain}" class="admin-link">Go to Admin Panel</a>
        <div class="footer">
            <p>Configure primary content in Settings to display your site here.</p>
        </div>
    </div>
</body>
</html>';
    }
}
`;
  }

  /**
   * CE mode: nginx handles SSL directly on port 443
   */
  private generateCEWelcomePageConfig(baseDomain: string): string {
    return `# Primary Content Configuration - Welcome Page
# Generated: ${new Date().toISOString()}
# Status: Disabled - showing welcome page

# Root domain redirect to www
server {
    listen 443 ssl;
    http2 on;
    server_name ${baseDomain};

    ssl_certificate /etc/nginx/ssl/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Block vulnerability scanners (drop connection silently)
    if ($block_scanner) {
        return 444;
    }

    return 301 https://www.${baseDomain}$request_uri;
}

# WWW - Welcome page
server {
    listen 443 ssl;
    http2 on;
    server_name www.${baseDomain};

    ssl_certificate /etc/nginx/ssl/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Cache-Hit "none" always;

    # Block vulnerability scanners (drop connection silently)
    if ($block_scanner) {
        return 444;
    }

    location / {
        default_type text/html;
        return 200 '<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome - BFFLESS</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #ede8dd;
            color: #3a3a3a;
        }
        .container {
            text-align: center;
            padding: 2rem;
            max-width: 600px;
        }
        .logo {
            width: 160px;
            height: 160px;
            margin-bottom: 1.5rem;
        }
        h1 {
            font-size: 2.5rem;
            margin-bottom: 0.5rem;
            font-weight: 700;
            color: #3a3a3a;
        }
        p {
            font-size: 1.1rem;
            color: #4a4a4a;
            margin-bottom: 2rem;
            line-height: 1.6;
        }
        .admin-link {
            display: inline-block;
            padding: 0.75rem 2rem;
            background: #d96459;
            color: white;
            text-decoration: none;
            border-radius: 8px;
            font-weight: 600;
            transition: transform 0.2s, box-shadow 0.2s, background 0.2s;
        }
        .admin-link:hover {
            background: #c55449;
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(217, 100, 89, 0.3);
        }
        .footer {
            margin-top: 3rem;
            font-size: 0.875rem;
            color: #4a4a4a;
            opacity: 0.7;
        }
    </style>
</head>
<body>
    <div class="container">
        <img class="logo" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MDAiIGhlaWdodD0iNDAwIiB2aWV3Qm94PSIwIDAgNDAwIDQwMCI+PGcgc3Ryb2tlPSIjNGE0YTRhIiBzdHJva2Utd2lkdGg9IjUiIGZpbGw9Im5vbmUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0iTTExNSAyMTUgTDExNSAyOTUgTDU1IDI5NSBMNTUgMzU1Ii8+PHBhdGggZD0iTTE1NSAyMzUgTDE1NSAzMjAgTDEzMCAzMjAgTDEzMCAzNzAiLz48cGF0aCBkPSJNMjQ1IDIzNSBMMjQ1IDMyMCBMMjcwIDMyMCBMMjcwIDM3MCIvPjxwYXRoIGQ9Ik0yODUgMjE1IEwyODUgMjk1IEwzNDUgMjk1IEwzNDUgMzU1Ii8+PC9nPjxnIGZpbGw9IiM0YTRhNGEiPjxjaXJjbGUgY3g9IjU1IiBjeT0iMzYwIiByPSI4Ii8+PGNpcmNsZSBjeD0iMTMwIiBjeT0iMzc1IiByPSI4Ii8+PGNpcmNsZSBjeD0iMjcwIiBjeT0iMzc1IiByPSI4Ii8+PGNpcmNsZSBjeD0iMzQ1IiBjeT0iMzYwIiByPSI4Ii8+PC9nPjxnIGZpbGw9IndoaXRlIj48Y2lyY2xlIGN4PSI1NSIgY3k9IjM2MCIgcj0iMyIvPjxjaXJjbGUgY3g9IjEzMCIgY3k9IjM3NSIgcj0iMyIvPjxjaXJjbGUgY3g9IjI3MCIgY3k9IjM3NSIgcj0iMyIvPjxjaXJjbGUgY3g9IjM0NSIgY3k9IjM2MCIgcj0iMyIvPjwvZz48cGF0aCBkPSJNMTk1IDg1IEMxOTAgNTUgMTcwIDM1IDE0MCAzNSBDMTAwIDM1IDYwIDYwIDYwIDExMCBDNjAgMjAwIDE1MCAyMzAgMTk1IDI4MCBMMjA1IDI0MCBMMTg1IDIwMCBMMjA1IDE2MCBMMTg1IDEyMCBMMTk1IDg1IFoiIGZpbGw9IiNjOTVjNTQiLz48cGF0aCBkPSJNMjA1IDg1IEMyMTAgNTUgMjMwIDM1IDI2MCAzNSBDMzAwIDM1IDM0MCA2MCAzNDAgMTEwIEMzNDAgMjAwIDI1MCAyMzAgMjA1IDI4MCBMMjE1IDI0MCBMMTk1IDIwMCBMMjE1IDE2MCBMMTk1IDEyMCBMMjA1IDg1IFoiIGZpbGw9IiNjOTVjNTQiLz48cGF0aCBkPSJNMTI1IDYwIEMxMDAgNzIgOTUgMTAwIDExMCAxMjAiIHN0cm9rZT0icmdiYSgyNTUsMjU1LDI1NSwwLjM1KSIgc3Ryb2tlLXdpZHRoPSIxNCIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBmaWxsPSJub25lIiB0cmFuc2Zvcm09InJvdGF0ZSgyMCAxMTAgOTApIi8+PC9zdmc+" alt="BFFLESS"/>
        <h1>Welcome to BFFLESS</h1>
        <p>Primary content has not been configured yet.</p>
        <a href="https://admin.${baseDomain}" class="admin-link">Go to Admin Panel</a>
        <div class="footer">
            <p>Configure primary content in Settings to display your site here.</p>
        </div>
    </div>
</body>
</html>';
    }
}
`;
  }

  // =====================
  // Redirect Config Methods
  // =====================

  async generateRedirectConfig(data: RedirectConfigData): Promise<string> {
    if (!data.isActive) {
      return '# Redirect inactive';
    }

    // Determine if SSL should be enabled
    // For subdomains, check ENABLE_WILDCARD_SSL flag - if false (PaaS mode where Traefik handles SSL),
    // force sslEnabled to false so nginx doesn't try to load wildcard certs
    let sslEnabled = data.sslEnabled;
    const baseDomain = this.getBaseDomain();
    const isSubdomain = data.sourceDomain.endsWith(`.${baseDomain}`);
    if (isSubdomain) {
      const wildcardSslEnabled = await this.featureFlagsService.isEnabled('ENABLE_WILDCARD_SSL');
      if (!wildcardSslEnabled) {
        sslEnabled = false;
        this.logger.debug(
          `Redirect ${data.sourceDomain}: SSL disabled (ENABLE_WILDCARD_SSL=false, Traefik handles SSL)`,
        );
      }
    }

    const sslCertPath = sslEnabled ? this.getSslCertPath(data.sourceDomain) : undefined;
    const sslKeyPath = sslEnabled ? this.getSslKeyPath(data.sourceDomain) : undefined;

    return this.redirectTemplate({
      sourceDomain: data.sourceDomain,
      targetDomain: data.targetDomain,
      redirectType: data.redirectType,
      sslEnabled,
      sslCertPath,
      sslKeyPath,
      protocol: sslEnabled ? 'https' : 'http',
      listenPort: this.getNginxListenPort(),
      createdAt: new Date().toISOString(),
    });
  }

  async writeRedirectConfigFile(
    redirectId: string,
    config: string,
  ): Promise<{ tempPath: string; finalPath: string }> {
    const filename = `redirect-${redirectId}.conf`;
    const tempPath = join('/tmp', filename);
    const finalPath = join(this.getNginxSitesPath(), filename);

    await writeFile(tempPath, config, 'utf-8');
    this.logger.log(`Wrote redirect nginx config to temp file: ${tempPath}`);

    return { tempPath, finalPath };
  }

  private getSslCertPath(domain: string): string {
    const baseDomain = process.env.PRIMARY_DOMAIN || 'localhost';
    // Check if domain is a subdomain of BASE_DOMAIN (use wildcard cert)
    if (domain.endsWith(`.${baseDomain}`)) {
      return `/etc/nginx/ssl/wildcard.${baseDomain}.crt`;
    }
    // Custom domain - individual cert
    return `/etc/nginx/ssl/${domain}/fullchain.pem`;
  }

  private getSslKeyPath(domain: string): string {
    const baseDomain = process.env.PRIMARY_DOMAIN || 'localhost';
    if (domain.endsWith(`.${baseDomain}`)) {
      return `/etc/nginx/ssl/wildcard.${baseDomain}.key`;
    }
    return `/etc/nginx/ssl/${domain}/privkey.pem`;
  }
}
