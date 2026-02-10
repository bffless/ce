import {
  Controller,
  Get,
  Param,
  Res,
  BadRequestException,
  Inject,
  UseGuards,
  Req,
  Logger,
  Optional,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Response, Request } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { eq, and } from 'drizzle-orm';
import crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { db } from '../db/client';
import { assets, deploymentAliases, domainMappings } from '../db/schema';
import { IStorageAdapter, STORAGE_ADAPTER, DownloadResult } from '../storage/storage.interface';
import { DeploymentsService } from './deployments.service';
import { ProjectsService } from '../projects/projects.service';
import { OptionalAuthGuard } from '../auth/optional-auth.guard';
import { VisibilityService, AccessControlInfo } from '../domains/visibility.service';
import { TrafficRoutingService } from '../domains/traffic-routing.service';
import { PermissionsService, ProjectRole } from '../permissions/permissions.service';
import { ConfigService } from '@nestjs/config';
import { CacheConfigService } from '../cache-rules/cache-config.service';
import { MetadataCacheService } from '../storage/cache/metadata-cache.service';
import { ShareLinksService } from '../share-links/share-links.service';

/**
 * Options for serving files with appropriate cache headers
 */
interface ServeFileOptions {
  /** Whether the content is immutable (SHA-based URLs) */
  immutable: boolean;
  /** HTTP status code to send */
  statusCode?: number;
  /** Whether the content is publicly accessible (affects Cache-Control directive) */
  isPublic: boolean;
  /** Project ID for cache rule lookup */
  projectId: string;
  /** File path for cache rule pattern matching */
  filePath: string;
}

// Common MIME type mapping
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.wasm': 'application/wasm',
};

@ApiTags('Public')
@Controller('public')
@SkipThrottle()
@UseGuards(OptionalAuthGuard)
export class PublicController {
  private readonly logger = new Logger(PublicController.name);
  private readonly svg404: string;
  private readonly svg403: string;

  constructor(
    @Inject(STORAGE_ADAPTER) private readonly storageAdapter: IStorageAdapter,
    private readonly deploymentsService: DeploymentsService,
    private readonly projectsService: ProjectsService,
    private readonly visibilityService: VisibilityService,
    private readonly trafficRoutingService: TrafficRoutingService,
    private readonly permissionsService: PermissionsService,
    private readonly configService: ConfigService,
    private readonly cacheConfigService: CacheConfigService,
    private readonly shareLinksService: ShareLinksService,
    @Optional() private readonly metadataCache?: MetadataCacheService,
  ) {
    // Cache SVG assets at startup
    this.svg404 = fs.readFileSync(path.join(__dirname, 'assets', '404.svg'), 'utf-8');
    this.svg403 = fs.readFileSync(path.join(__dirname, 'assets', '403.svg'), 'utf-8');
  }

  /**
   * Serve public assets by owner/repo with default alias resolution
   * GET /public/:owner/:repo/
   */
  @Get(':owner/:repo')
  @ApiOperation({ summary: 'Serve default deployment for repository' })
  @ApiParam({ name: 'owner', description: 'Repository owner' })
  @ApiParam({ name: 'repo', description: 'Repository name' })
  @ApiResponse({ status: 200, description: 'File content' })
  @ApiResponse({ status: 404, description: 'Deployment not found' })
  async serveDefault(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const repository = `${owner}/${repo}`;
    const commitSha = await this.deploymentsService.getDefaultAlias(repository);

    if (!commitSha) {
      return this.serve404Page(res, `No deployment found for ${repository}`);
    }

    // Get project for visibility check
    const project = await this.projectsService.getProjectByOwnerName(owner, repo);

    // PHASE B5: Check alias-level visibility and access control (cascade: alias → project)
    // Default alias is determined by priority: production > main > master > latest
    const defaultAliasNames = ['production', 'main', 'master', 'latest'];
    let accessControl: AccessControlInfo = {
      isPublic: project.isPublic,
      unauthorizedBehavior:
        (project.unauthorizedBehavior as 'not_found' | 'redirect_login') || 'not_found',
      requiredRole:
        (project.requiredRole as 'authenticated' | 'viewer' | 'contributor' | 'admin' | 'owner') ||
        'authenticated',
      source: 'project',
    };

    for (const aliasName of defaultAliasNames) {
      const resolvedSha = await this.deploymentsService.resolveAlias(repository, aliasName);
      if (resolvedSha === commitSha) {
        // Found the alias that resolved to this SHA, check its access control
        accessControl = await this.visibilityService.resolveAccessControlForAlias(
          project.id,
          aliasName,
        );
        break;
      }
    }

    // Check access control (with share token bypass)
    if (!accessControl.isPublic) {
      const shareTokenValid = await this.checkShareToken(req, res, project.id);

      if (!shareTokenValid) {
        const user = (req as any).user;

        if (!user) {
          // Not authenticated - check unauthorized behavior
          if (accessControl.unauthorizedBehavior === 'redirect_login') {
            // Don't redirect for image requests - serve placeholder instead
            if (this.isImageRequest(req)) {
              return this.serve404Image(res);
            }
            const fullUrl = this.buildFullRequestUrl(req);
            // Try session restore first if refresh token exists, otherwise go to login
            const authUrl = this.getAuthRedirectUrl(req, fullUrl);
            return res.redirect(302, authUrl);
          }
          return this.isImageRequest(req) ? this.serve404Image(res) : this.serve404Page(res);
        }

        // Authenticated - check role-based access
        const userRole = await this.permissionsService.getUserProjectRole(user.id, project.id);

        if (!this.permissionsService.meetsRoleRequirement(userRole, accessControl.requiredRole)) {
          if (this.isImageRequest(req)) {
            return this.serve403Image(res);
          }
          return this.serve403Page(res, {
            requiredRole: accessControl.requiredRole,
            currentRole: userRole,
            projectName: project.displayName || project.name,
          });
        }
      }
    }

    // Redirect to commits URL for proper caching
    res.redirect(301, `/public/${repository}/commits/${commitSha}/`);
  }

  /**
   * Serve public assets by commit SHA
   * GET /public/:owner/:repo/commits/:sha/*
   */
  @Get(':owner/:repo/commits/:sha/*')
  @ApiOperation({ summary: 'Serve public asset by commit SHA' })
  @ApiParam({ name: 'owner', description: 'Repository owner' })
  @ApiParam({ name: 'repo', description: 'Repository name' })
  @ApiParam({ name: 'sha', description: 'Commit SHA (7-40 characters)' })
  @ApiResponse({ status: 200, description: 'File content' })
  @ApiResponse({ status: 304, description: 'Not modified (cached)' })
  @ApiResponse({ status: 404, description: 'File not found' })
  async serveCommitAsset(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('sha') sha: string,
    @Param('0') filePath: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    // Validate SHA format
    if (!/^[a-f0-9]{7,40}$/i.test(sha)) {
      throw new BadRequestException('Invalid commit SHA format');
    }

    await this.serveAssetInternal(owner, repo, sha, null, filePath, req, res, true);
  }

  /**
   * Serve public assets by alias
   * GET /public/:owner/:repo/alias/:aliasName/*
   */
  @Get(':owner/:repo/alias/:aliasName/*')
  @ApiOperation({ summary: 'Serve public asset by alias' })
  @ApiParam({ name: 'owner', description: 'Repository owner' })
  @ApiParam({ name: 'repo', description: 'Repository name' })
  @ApiParam({ name: 'aliasName', description: 'Deployment alias (e.g., main, production)' })
  @ApiResponse({ status: 200, description: 'File content' })
  @ApiResponse({ status: 304, description: 'Not modified (cached)' })
  @ApiResponse({ status: 404, description: 'File or alias not found' })
  async serveAliasAsset(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('aliasName') aliasName: string,
    @Param('0') filePath: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const repository = `${owner}/${repo}`;

    // Phase C: Check for multivariant traffic routing
    let effectiveAlias = aliasName;
    let variantSelection: {
      selectedAlias: string;
      isNewSelection: boolean;
      stickySessionDuration: number;
    } | null = null;

    const forwardedHost = req.headers['x-forwarded-host'] as string | undefined;
    if (forwardedHost) {
      const variantCookie = req.cookies?.[TrafficRoutingService.VARIANT_COOKIE_NAME];
      variantSelection = await this.trafficRoutingService.selectVariant(
        forwardedHost,
        variantCookie,
        req.query as Record<string, string>,
        req.cookies,
      );

      if (variantSelection) {
        this.logger.debug(
          `[serveAliasAsset] Traffic routing: domain=${forwardedHost}, originalAlias=${aliasName}, selectedVariant=${variantSelection.selectedAlias}`,
        );
        effectiveAlias = variantSelection.selectedAlias;
      }
    }

    // Resolve alias to SHA
    const commitSha = await this.deploymentsService.resolveAlias(repository, effectiveAlias);
    if (!commitSha) {
      return this.serve404Page(res, `Alias not found: ${effectiveAlias}`);
    }

    // Set variant cookie if new selection
    if (variantSelection?.isNewSelection) {
      res.cookie(TrafficRoutingService.VARIANT_COOKIE_NAME, variantSelection.selectedAlias, {
        maxAge: variantSelection.stickySessionDuration === 0
          ? 10 * 365 * 24 * 60 * 60 * 1000 // No expiration: 10 years
          : variantSelection.stickySessionDuration * 1000,
        httpOnly: false,
        secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
        sameSite: 'lax',
        path: '/',
      });
    }

    // Always set X-Variant header when traffic splitting is active
    if (variantSelection) {
      res.setHeader('X-Variant', variantSelection.selectedAlias);
    }

    await this.serveAssetInternal(
      owner,
      repo,
      commitSha,
      effectiveAlias,
      filePath,
      req,
      res,
      false,
    );
  }

  /**
   * Serve assets via subdomain alias
   * Called by nginx for wildcard subdomains (*.PRIMARY_DOMAIN)
   * GET /public/subdomain-alias/:aliasName/*
   */
  @Get('subdomain-alias/:aliasName/*')
  @ApiOperation({ summary: 'Serve asset via subdomain alias' })
  @ApiParam({ name: 'aliasName', description: 'Alias name (extracted from subdomain)' })
  @ApiResponse({ status: 200, description: 'File content' })
  @ApiResponse({ status: 404, description: 'Alias or file not found' })
  async serveSubdomainAlias(
    @Param('aliasName') aliasName: string,
    @Param('0') filePath: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    this.logger.debug(
      `[serveSubdomainAlias] Request: aliasName=${aliasName}, filePath=${filePath}`,
    );

    // Look up alias by name across all projects
    const [aliasRecord] = await db
      .select()
      .from(deploymentAliases)
      .where(eq(deploymentAliases.alias, aliasName))
      .limit(1);

    if (!aliasRecord) {
      // Fallback: check if the original host matches a domain mapping.
      // This handles the case where nginx's wildcard catch-all intercepts requests
      // that should have gone to domain-specific server blocks (e.g., when the
      // domain config hasn't been loaded by nginx yet, or after a restart).
      this.logger.debug(
        `[serveSubdomainAlias] Alias '${aliasName}' not found, checking domain mapping fallback`,
      );
      const forwardedHost = req.headers['x-forwarded-host'] as string | undefined;
      if (forwardedHost) {
        const served = await this.serveDomainMappingFallback(forwardedHost, filePath, req, res);
        if (served) return;
      }

      return this.serve404Page(res, `Preview not found: ${aliasName}`);
    }

    this.logger.debug(
      `[serveSubdomainAlias] Alias '${aliasName}' FOUND, serving directly (no domain mapping path prefix)`,
    );

    // Get project from alias
    const project = await this.projectsService.getProjectById(aliasRecord.projectId);

    // For auto-preview aliases with basePath, prepend the basePath to the file path
    let fullPath = filePath || '';
    if (aliasRecord.basePath && aliasRecord.isAutoPreview) {
      // Remove leading slash from basePath and filePath for consistency
      const normalizedBasePath = aliasRecord.basePath.replace(/^\/+/, '').replace(/\/+$/, '');
      fullPath = normalizedBasePath ? `${normalizedBasePath}/${fullPath}` : fullPath;
    }

    // Remove duplicate slashes
    fullPath = fullPath.replace(/\/+/g, '/');

    await this.serveAssetInternal(
      project.owner,
      project.name,
      aliasRecord.commitSha,
      aliasName,
      fullPath,
      req,
      res,
      false, // Not immutable - alias-based
    );
  }

  /**
   * Serve root path for subdomain alias
   * GET /public/subdomain-alias/:aliasName (no trailing path)
   */
  @Get('subdomain-alias/:aliasName')
  @ApiOperation({ summary: 'Serve root asset via subdomain alias' })
  @ApiParam({ name: 'aliasName', description: 'Alias name (extracted from subdomain)' })
  @ApiResponse({ status: 200, description: 'File content' })
  @ApiResponse({ status: 404, description: 'Alias or file not found' })
  async serveSubdomainAliasRoot(
    @Param('aliasName') aliasName: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    return this.serveSubdomainAlias(aliasName, '', req, res);
  }

  /**
   * Internal method to serve assets (shared by commit and alias routes)
   */
  private async serveAssetInternal(
    owner: string,
    repo: string,
    commitSha: string,
    aliasName: string | null,
    filePath: string,
    req: Request,
    res: Response,
    isImmutable: boolean,
  ): Promise<void> {
    // const repository = `${owner}/${repo}`;

    this.logger.debug(
      `[serveAssetInternal] Request: owner=${owner}, repo=${repo}, commitSha=${commitSha}, aliasName=${aliasName}, filePath=${filePath}`,
    );

    // Get project for visibility check
    const project = await this.projectsService.getProjectByOwnerName(owner, repo);

    // Security: Prevent path traversal
    if (filePath && this.containsPathTraversal(filePath)) {
      throw new BadRequestException('Invalid file path');
    }

    // PHASE B5: Check visibility cascade and access control
    const forwardedHost = req.headers['x-forwarded-host'] as string | undefined;
    let accessControl: AccessControlInfo;

    if (forwardedHost) {
      const domainAccessControl =
        await this.visibilityService.resolveAccessControlByDomain(forwardedHost);
      if (domainAccessControl !== null) {
        accessControl = domainAccessControl;
      } else if (aliasName) {
        accessControl = await this.visibilityService.resolveAccessControlForAlias(
          project.id,
          aliasName,
        );
      } else {
        // Fall back to project defaults
        accessControl = {
          isPublic: project.isPublic,
          unauthorizedBehavior:
            (project.unauthorizedBehavior as 'not_found' | 'redirect_login') || 'not_found',
          requiredRole:
            (project.requiredRole as
              | 'authenticated'
              | 'viewer'
              | 'contributor'
              | 'admin'
              | 'owner') || 'authenticated',
          source: 'project',
        };
      }
    } else if (aliasName) {
      accessControl = await this.visibilityService.resolveAccessControlForAlias(
        project.id,
        aliasName,
      );
    } else {
      // Fall back to project defaults
      accessControl = {
        isPublic: project.isPublic,
        unauthorizedBehavior:
          (project.unauthorizedBehavior as 'not_found' | 'redirect_login') || 'not_found',
        requiredRole:
          (project.requiredRole as
            | 'authenticated'
            | 'viewer'
            | 'contributor'
            | 'admin'
            | 'owner') || 'authenticated',
        source: 'project',
      };
    }

    // Check access control (with share token bypass)
    if (!accessControl.isPublic) {
      const domainMappingId = forwardedHost
        ? await this.getDomainMappingId(forwardedHost)
        : undefined;
      const shareTokenValid = await this.checkShareToken(req, res, project.id, domainMappingId);

      if (!shareTokenValid) {
        const user = (req as any).user;

        if (!user) {
          // Not authenticated - check unauthorized behavior
          if (accessControl.unauthorizedBehavior === 'redirect_login') {
            // Don't redirect for image requests - serve placeholder instead
            if (this.isImageRequest(req)) {
              return this.serve404Image(res);
            }
            const fullUrl = this.buildFullRequestUrl(req);
            // Try session restore first if refresh token exists, otherwise go to login
            const authUrl = this.getAuthRedirectUrl(req, fullUrl);
            return res.redirect(302, authUrl);
          }
          return this.isImageRequest(req) ? this.serve404Image(res) : this.serve404Page(res);
        }

        // Authenticated - check role-based access
        const userRole = await this.permissionsService.getUserProjectRole(user.id, project.id);

        if (!this.permissionsService.meetsRoleRequirement(userRole, accessControl.requiredRole)) {
          if (this.isImageRequest(req)) {
            return this.serve403Image(res);
          }
          return this.serve403Page(res, {
            requiredRole: accessControl.requiredRole,
            currentRole: userRole,
            projectName: project.displayName || project.name,
          });
        }
      }
    }

    // Normalize file path
    let normalizedPath = filePath || '';
    if (!normalizedPath || normalizedPath.endsWith('/')) {
      normalizedPath = normalizedPath + 'index.html';
    }

    // Find the asset in database (with caching)
    const asset = await this.getAssetWithCache(project.id, commitSha, normalizedPath);

    if (!asset) {
      // Try to serve 404.html if it exists (also cached)
      const notFoundPage = await this.getAssetWithCache(project.id, commitSha, '404.html');

      if (notFoundPage) {
        return this.serveFile(notFoundPage, res, {
          immutable: false,
          statusCode: 404,
          isPublic: accessControl.isPublic,
          projectId: project.id,
          filePath: '404.html',
        });
      }

      // Serve image placeholder for image requests, HTML page otherwise
      return this.isImageRequest(req)
        ? this.serve404Image(res)
        : this.serve404Page(res, `File not found: ${normalizedPath}`);
    }

    // Add response headers
    res.setHeader('X-Served-Sha', commitSha);
    if (aliasName) {
      res.setHeader('X-Served-Alias', aliasName);
    }

    await this.serveFile(asset, res, {
      immutable: isImmutable,
      statusCode: 200,
      isPublic: accessControl.isPublic,
      projectId: project.id,
      filePath: normalizedPath,
    });
  }

  /**
   * Serve file with appropriate headers
   */
  private async serveFile(
    asset: typeof assets.$inferSelect,
    res: Response,
    options: ServeFileOptions,
  ): Promise<void> {
    const { immutable, statusCode = 200, isPublic, projectId, filePath } = options;

    try {
      // Get cache configuration from rules (or defaults) BEFORE download
      // so we can pass TTL hint to Redis caching
      const cacheConfig = await this.cacheConfigService.getCacheConfig(
        projectId,
        filePath,
        immutable,
      );

      // Calculate Redis TTL from cache config
      const redisTtl = this.cacheConfigService.calculateRedisTtl(cacheConfig);

      // Download file from storage with cache info for analytics
      let fileBuffer: Buffer;
      let cacheHit: DownloadResult['cacheHit'] = 'none';

      if (this.storageAdapter.downloadWithCacheInfo) {
        const result = await this.storageAdapter.downloadWithCacheInfo(asset.storageKey, redisTtl);
        fileBuffer = result.data;
        cacheHit = result.cacheHit;
      } else {
        fileBuffer = await this.storageAdapter.download(asset.storageKey);
      }

      // Set content type
      const mimeType = asset.mimeType || this.getMimeType(asset.fileName);

      // Generate ETag - use pre-computed contentHash if available, otherwise compute MD5
      // (backwards compatibility for old assets without contentHash)
      const etag = asset.contentHash ? `"${asset.contentHash}"` : this.generateETag(fileBuffer);

      // Check If-None-Match header for 304 response
      const clientEtag = res.req.headers['if-none-match'];
      if (clientEtag === etag) {
        res.status(304).end();
        return;
      }

      res.setHeader('Content-Type', mimeType);

      // Set content length
      res.setHeader('Content-Length', fileBuffer.length);

      // Set ETag
      res.setHeader('ETag', etag);

      // Build and set Cache-Control header
      const cacheControlHeader = this.cacheConfigService.buildCacheControlHeader(
        cacheConfig,
        isPublic,
      );
      res.setHeader('Cache-Control', cacheControlHeader);

      // Add debug headers for cache rule matching
      res.setHeader('X-Cache-Path', filePath);
      res.setHeader('X-Cache-Project', projectId);
      res.setHeader('X-Cache-Source', cacheConfig.source);
      if (cacheConfig.source === 'rule' && cacheConfig.matchedRule) {
        res.setHeader('X-Cache-Rule', cacheConfig.matchedRule.pathPattern);
      }

      // Security headers
      res.setHeader('X-Content-Type-Options', 'nosniff');

      // Analytics header for cache tracking
      res.setHeader('X-Cache-Hit', cacheHit);

      // Send the file
      res.status(statusCode).send(fileBuffer);
    } catch (error) {
      this.logger.error(`Failed to download from storage: ${asset.storageKey}`, error);
      return this.serve404Page(res, `File not found: ${asset.fileName}`);
    }
  }

  /**
   * Get asset from cache or database
   * Caches asset metadata to reduce DB roundtrips on cache hits
   */
  private async getAssetWithCache(
    projectId: string,
    commitSha: string,
    publicPath: string,
  ): Promise<typeof assets.$inferSelect | null> {
    // TTL for asset metadata cache: same as file content cache (1 hour)
    const ASSET_CACHE_TTL = 3600;

    // Try cache first
    if (this.metadataCache) {
      const cacheKey = this.metadataCache.assetKey(projectId, commitSha, publicPath);
      const cached = await this.metadataCache.get<typeof assets.$inferSelect>(cacheKey);
      if (cached) {
        this.logger.debug(`Asset cache HIT: ${projectId}/${commitSha}/${publicPath}`);
        return cached;
      }
    }

    // Query database
    const [asset] = await db
      .select()
      .from(assets)
      .where(
        and(
          eq(assets.projectId, projectId),
          eq(assets.commitSha, commitSha),
          eq(assets.publicPath, publicPath),
        ),
      )
      .limit(1);

    // Cache the result (even null results are cached as empty to avoid repeated DB queries)
    if (this.metadataCache && asset) {
      const cacheKey = this.metadataCache.assetKey(projectId, commitSha, publicPath);
      await this.metadataCache.set(cacheKey, asset, ASSET_CACHE_TTL);
      this.logger.debug(`Asset cache MISS: ${projectId}/${commitSha}/${publicPath} - cached`);
    }

    return asset || null;
  }

  /**
   * Fallback handler for when the wildcard catch-all intercepts requests that should
   * have been handled by domain-specific nginx server blocks.
   *
   * Checks if the original host matches a domain mapping (direct or primary domain),
   * and if so, serves content via that mapping's project and alias.
   * This ensures share tokens and domain-mapped content work even when nginx routing
   * falls through to the wildcard catch-all.
   *
   * Returns true if the request was handled, false if no matching domain mapping was found.
   */
  private async serveDomainMappingFallback(
    host: string,
    filePath: string,
    req: Request,
    res: Response,
  ): Promise<boolean> {
    // Try direct domain match first
    let [mapping] = await db
      .select()
      .from(domainMappings)
      .where(and(eq(domainMappings.domain, host), eq(domainMappings.isActive, true)))
      .limit(1);

    // If no direct match, check if host is the primary domain or www.primary_domain
    if (!mapping) {
      const primaryDomain = this.configService.get<string>('PRIMARY_DOMAIN') || 'localhost';
      if (host === primaryDomain || host === `www.${primaryDomain}`) {
        const [primaryMapping] = await db
          .select()
          .from(domainMappings)
          .where(and(eq(domainMappings.isPrimary, true), eq(domainMappings.isActive, true)))
          .limit(1);

        if (primaryMapping) {
          // Handle www redirect behavior
          if (primaryMapping.wwwBehavior === 'redirect-to-www' && host === primaryDomain) {
            const protocol = req.headers['x-forwarded-proto'] || 'https';
            res.redirect(301, `${protocol}://www.${primaryDomain}${req.headers['x-original-uri'] || '/'}`);
            return true;
          }
          if (primaryMapping.wwwBehavior === 'redirect-to-root' && host === `www.${primaryDomain}`) {
            const protocol = req.headers['x-forwarded-proto'] || 'https';
            res.redirect(301, `${protocol}://${primaryDomain}${req.headers['x-original-uri'] || '/'}`);
            return true;
          }
          mapping = primaryMapping;
        }
      }
    }

    if (!mapping || !mapping.projectId || !mapping.alias) {
      return false;
    }

    // Handle redirect domain type
    if (mapping.domainType === 'redirect' && mapping.redirectTarget) {
      res.redirect(301, `https://${mapping.redirectTarget}${req.headers['x-original-uri'] || '/'}`);
      return true;
    }

    this.logger.debug(
      `[serveDomainMappingFallback] Resolved host=${host} to domain mapping id=${mapping.id}, project=${mapping.projectId}, alias=${mapping.alias}`,
    );

    const project = await this.projectsService.getProjectById(mapping.projectId);
    const repository = `${project.owner}/${project.name}`;

    // Check for multivariant traffic routing
    let effectiveAlias = mapping.alias;
    let variantSelection: {
      selectedAlias: string;
      isNewSelection: boolean;
      stickySessionDuration: number;
    } | null = null;

    const variantCookie = req.cookies?.[TrafficRoutingService.VARIANT_COOKIE_NAME];
    variantSelection = await this.trafficRoutingService.selectVariant(
      host,
      variantCookie,
      req.query as Record<string, string>,
      req.cookies,
    );

    if (variantSelection) {
      this.logger.debug(
        `[serveDomainMappingFallback] Traffic routing: domain=${host}, originalAlias=${mapping.alias}, selectedVariant=${variantSelection.selectedAlias}`,
      );
      effectiveAlias = variantSelection.selectedAlias;
    }

    const commitSha = await this.deploymentsService.resolveAlias(repository, effectiveAlias);

    if (!commitSha) {
      return false;
    }

    // Set variant cookie if new selection
    if (variantSelection?.isNewSelection) {
      res.cookie(TrafficRoutingService.VARIANT_COOKIE_NAME, variantSelection.selectedAlias, {
        maxAge: variantSelection.stickySessionDuration === 0
          ? 10 * 365 * 24 * 60 * 60 * 1000 // No expiration: 10 years
          : variantSelection.stickySessionDuration * 1000,
        httpOnly: false,
        secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
        sameSite: 'lax',
        path: '/',
      });
    }

    // Always set X-Variant header when traffic splitting is active
    if (variantSelection) {
      res.setHeader('X-Variant', variantSelection.selectedAlias);
    }

    // Apply path prefix from domain mapping
    // For internal rewrites, the target path is relative to the domain's path context
    const pathPrefix = mapping.path ? mapping.path.replace(/^\/+/, '').replace(/\/+$/, '') : '';
    const fullPath = pathPrefix ? `${pathPrefix}/${filePath || ''}` : (filePath || '');

    this.logger.debug(
      `[serveDomainMappingFallback] Path resolution: mapping.path=${mapping.path}, pathPrefix=${pathPrefix}, filePath=${filePath}, fullPath=${fullPath}`,
    );

    await this.serveAssetInternal(
      project.owner,
      project.name,
      commitSha,
      effectiveAlias,
      fullPath.replace(/\/+/g, '/'),
      req,
      res,
      false,
    );
    return true;
  }

  /**
   * Check if a share token is present (query param or cookie) and valid.
   * If valid and the token came from a query param, sets the __bffless_share cookie.
   * Returns true if the share token grants access, false otherwise.
   */
  private async checkShareToken(
    req: Request,
    res: Response,
    projectId: string,
    domainMappingId?: string,
  ): Promise<boolean> {
    const shareToken = (req.query?.token as string) || req.cookies?.__bffless_share;
    if (!shareToken) return false;

    const validLink = await this.shareLinksService.validateToken(
      shareToken,
      projectId,
      domainMappingId,
    );
    if (!validLink) return false;

    // Set cookie if token came from query param (so subsequent asset requests work)
    if (req.query?.token) {
      const maxAge = validLink.expiresAt
        ? Math.max(0, new Date(validLink.expiresAt).getTime() - Date.now())
        : 30 * 24 * 60 * 60 * 1000; // 30 days default

      res.cookie('__bffless_share', shareToken, {
        maxAge,
        httpOnly: true,
        secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
        sameSite: 'lax',
        path: '/',
      });
    }

    return true;
  }

  /**
   * Look up domain mapping ID by domain name.
   * Handles www variants: if "www.example.com" isn't found, tries "example.com"
   * and vice versa. This is needed because primary domain mappings store the
   * root domain (e.g., "j5s.dev") but www behavior causes requests to arrive
   * from "www.j5s.dev".
   */
  private async getDomainMappingId(domain: string): Promise<string | undefined> {
    const [mapping] = await db
      .select({ id: domainMappings.id })
      .from(domainMappings)
      .where(eq(domainMappings.domain, domain))
      .limit(1);
    if (mapping) return mapping.id;

    // Try www variant: www.x.com → x.com, or x.com → www.x.com
    const altDomain = domain.startsWith('www.')
      ? domain.slice(4)
      : `www.${domain}`;
    const [altMapping] = await db
      .select({ id: domainMappings.id })
      .from(domainMappings)
      .where(eq(domainMappings.domain, altDomain))
      .limit(1);
    return altMapping?.id;
  }

  /**
   * Generate ETag from file content
   */
  private generateETag(buffer: Buffer): string {
    const hash = crypto.createHash('md5').update(buffer).digest('hex');
    return `"${hash}"`;
  }

  /**
   * Get MIME type from file extension
   */
  private getMimeType(filename: string): string {
    const ext = '.' + filename.split('.').pop()?.toLowerCase();
    return MIME_TYPES[ext] || 'application/octet-stream';
  }

  /**
   * Check for path traversal attempts
   */
  private containsPathTraversal(path: string): boolean {
    const normalized = path.replace(/\\/g, '/');
    return (
      normalized.includes('../') ||
      normalized.includes('..\\') ||
      normalized.startsWith('/') ||
      normalized.includes('//') ||
      /^[a-zA-Z]:/.test(normalized)
    );
  }

  /**
   * Serve a styled 404 HTML page with optional custom message
   * This is used when access is denied or content is not found,
   * providing a nicer user experience than nginx's default error page.
   */
  private serve404Page(res: Response, message?: string): void {
    const displayMessage = message || "The page you're looking for doesn't exist.";
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Page Not Found</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            background: #f5f5f5;
        }
        .container {
            text-align: center;
            padding: 2rem;
        }
        h1 {
            font-size: 6rem;
            margin: 0;
            color: #333;
        }
        p {
            color: #666;
            margin: 1rem 0;
        }
        .detail {
            font-family: monospace;
            background: #e8e8e8;
            padding: 0.5rem 1rem;
            border-radius: 4px;
            display: inline-block;
            margin-top: 0.5rem;
        }
        a {
            color: #0070f3;
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>404</h1>
        <p>${displayMessage}</p>
        <a href="/">Go back home</a>
    </div>
</body>
</html>`;

    res.status(404).setHeader('Content-Type', 'text/html').send(html);
  }

  /**
   * Serve a styled 403 Forbidden page for authenticated users without sufficient role
   */
  private serve403Page(
    res: Response,
    info: { requiredRole: string; currentRole: ProjectRole | null; projectName: string },
  ): void {
    const roleLabels: Record<string, string> = {
      authenticated: 'Any authenticated user',
      viewer: 'Viewer',
      contributor: 'Contributor',
      admin: 'Admin',
      owner: 'Owner',
    };

    const requiredLabel = roleLabels[info.requiredRole] || info.requiredRole;
    const currentLabel = info.currentRole ? roleLabels[info.currentRole] : 'None';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Access Denied</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            background: #f5f5f5;
        }
        .container {
            text-align: center;
            padding: 2rem;
            max-width: 500px;
        }
        .icon {
            font-size: 4rem;
            margin-bottom: 1rem;
        }
        h1 {
            font-size: 2rem;
            margin: 0 0 1rem 0;
            color: #333;
        }
        p {
            color: #666;
            margin: 0.5rem 0;
        }
        .role-info {
            background: #fff;
            border: 1px solid #ddd;
            border-radius: 8px;
            padding: 1rem;
            margin: 1.5rem 0;
            text-align: left;
        }
        .role-row {
            display: flex;
            justify-content: space-between;
            padding: 0.5rem 0;
            border-bottom: 1px solid #eee;
        }
        .role-row:last-child {
            border-bottom: none;
        }
        .role-label {
            color: #666;
        }
        .role-value {
            font-weight: 500;
            color: #333;
        }
        a.button {
            display: inline-block;
            background: #0070f3;
            color: white;
            padding: 0.75rem 1.5rem;
            border-radius: 6px;
            text-decoration: none;
            margin-top: 1rem;
        }
        a.button:hover {
            background: #0060df;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">&#128274;</div>
        <h1>Access Denied</h1>
        <p>You don't have permission to access this content.</p>

        <div class="role-info">
            <div class="role-row">
                <span class="role-label">Project</span>
                <span class="role-value">${this.escapeHtml(info.projectName)}</span>
            </div>
            <div class="role-row">
                <span class="role-label">Required role</span>
                <span class="role-value">${requiredLabel} or higher</span>
            </div>
            <div class="role-row">
                <span class="role-label">Your role</span>
                <span class="role-value">${currentLabel}</span>
            </div>
        </div>

        <a href="/" class="button">Go to Dashboard</a>
    </div>
</body>
</html>`;

    res.status(403).setHeader('Content-Type', 'text/html').send(html);
  }

  /**
   * Build the full request URL including protocol, host, and path
   * For domain-mapped requests, uses X-Original-URI header (set by nginx before rewrite)
   */
  private buildFullRequestUrl(req: Request): string {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.headers['x-forwarded-host'] || req.get('host');

    // For domain-mapped requests, nginx sets X-Original-URI with the original path
    // before rewriting to /public/owner/repo/alias/...
    const originalUri = req.headers['x-original-uri'] as string | undefined;
    const path = originalUri || req.originalUrl;

    return `${protocol}://${host}${path}`;
  }

  /**
   * Build the login URL with redirect parameter
   * Redirects to admin.<workspace>.workspace.sahp.app/login (or ADMIN_DOMAIN if configured)
   * Always includes tryRefresh=true so the frontend can attempt session refresh
   * (Server can't check refresh token cookie due to cookie path restrictions)
   */
  private buildLoginUrl(req: Request, redirectUrl: string): string {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const params = `redirect=${encodeURIComponent(redirectUrl)}&tryRefresh=true`;

    // Use ADMIN_DOMAIN if configured (platform/multi-tenant setup)
    const adminDomain = this.configService.get<string>('ADMIN_DOMAIN');
    if (adminDomain) {
      return `${protocol}://${adminDomain}/login?${params}`;
    }

    // Fallback: extract workspace base from host (self-hosted single-tenant setups)
    const host = (req.headers['x-forwarded-host'] || req.get('host')) as string;
    const workspaceBase = this.extractWorkspaceBase(host);
    const loginHost = `admin.${workspaceBase}`;

    return `${protocol}://${loginHost}/login?${params}`;
  }

  /**
   * Get the auth redirect URL for private deployments
   * Always redirects to login with tryRefresh=true - the frontend handles session refresh
   * (Server can't reliably check for refresh token cookie due to cookie path restrictions)
   */
  private getAuthRedirectUrl(req: Request, redirectUrl: string): string {
    return this.buildLoginUrl(req, redirectUrl);
  }

  /**
   * Extract the workspace base domain from a subdomain
   *
   * Non-promoted workspaces (with .workspace. in the domain):
   * e.g., "storybook.demo.workspace.sahp.app" -> "demo.workspace.sahp.app"
   * e.g., "docs.console.workspace.sahp.app" -> "console.workspace.sahp.app"
   * e.g., "admin.console.workspace.sahp.app" -> "console.workspace.sahp.app"
   * e.g., "console.workspace.sahp.app" -> "console.workspace.sahp.app"
   *
   * Promoted workspaces (without .workspace. in the domain):
   * e.g., "cp.console.sahp.app" -> "console.sahp.app"
   * e.g., "admin.console.sahp.app" -> "console.sahp.app"
   * e.g., "console.sahp.app" -> "console.sahp.app"
   */
  private extractWorkspaceBase(host: string): string {
    const primaryDomain = this.configService.get<string>('PRIMARY_DOMAIN') || 'localhost';

    // Pattern 1: Non-promoted workspace - *.<workspace>.workspace.<primaryDomain>
    const workspaceMarker = `.workspace.${primaryDomain}`;
    if (host.endsWith(workspaceMarker)) {
      // Find workspace name (the part right before .workspace.)
      const withoutWorkspaceMarker = host.slice(0, -workspaceMarker.length);
      const parts = withoutWorkspaceMarker.split('.');
      const workspaceName = parts[parts.length - 1];
      return `${workspaceName}.workspace.${primaryDomain}`;
    }

    // Pattern 2: Promoted workspace - *.<workspace>.<primaryDomain>
    const primaryDomainSuffix = `.${primaryDomain}`;
    if (host.endsWith(primaryDomainSuffix)) {
      const withoutPrimaryDomain = host.slice(0, -primaryDomainSuffix.length);
      const parts = withoutPrimaryDomain.split('.');
      // Workspace is the last part (closest to primaryDomain)
      const workspaceName = parts[parts.length - 1];
      return `${workspaceName}.${primaryDomain}`;
    }

    // Fallback - return host as-is (local dev or custom domains)
    return host;
  }

  /**
   * Escape HTML to prevent XSS
   */
  private escapeHtml(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }

  /**
   * Check if the request path is for an image file
   */
  private isImageRequest(req: Request): boolean {
    const path = (req.headers['x-original-uri'] as string) || req.path || req.originalUrl || '';
    const ext = path.split('?')[0].toLowerCase().split('.').pop() || '';
    const imageExtensions = [
      'jpg',
      'jpeg',
      'png',
      'gif',
      'webp',
      'svg',
      'ico',
      'bmp',
      'tiff',
      'avif',
    ];
    return imageExtensions.includes(ext);
  }

  /**
   * Serve a placeholder image for 404 responses
   */
  private serve404Image(res: Response): void {
    res.status(404).setHeader('Content-Type', 'image/svg+xml').send(this.svg404);
  }

  /**
   * Serve a placeholder image for 403 responses
   */
  private serve403Image(res: Response): void {
    res.status(403).setHeader('Content-Type', 'image/svg+xml').send(this.svg403);
  }
}
