import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Req,
  Res,
  Logger,
  HttpCode,
  HttpStatus,
  BadRequestException,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiBody, ApiHeader } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { getSession } from 'supertokens-node/recipe/session';
import { SessionContainer } from 'supertokens-node/recipe/session';
import EmailPassword from 'supertokens-node/recipe/emailpassword';
import EmailVerification from 'supertokens-node/recipe/emailverification';
import { RecipeUserId, listUsersByAccountInfo } from 'supertokens-node';
import { eq } from 'drizzle-orm';
import { DomainTokenService } from './domain-token.service';
import { CustomDomainAuthService } from './custom-domain-auth.service';
import { AuthService } from './auth.service';
import { SetupService } from '../setup/setup.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { EmailService } from '../email/email.service';
import { ProjectResolverService } from './project-resolver.service';
import { OidcProvidersService } from '../settings/oidc-providers.service';
import { PermissionsService } from '../permissions/permissions.service';
import { ApiKeyGuard } from './api-key.guard';
import { PublicProjectAccess } from './decorators/public-project-access.decorator';
import { buildLoginMethodsResponse } from './login-methods.helper';
import { Project } from '../db/schema';
import { db } from '../db/client';
import { users } from '../db/schema';

/**
 * Controller for content domain authentication endpoints.
 * Handles auth for any domain serving deployed content (not the admin panel).
 *
 * Despite the name, this is NOT limited to custom domains — it handles auth for:
 * - Custom domains (e.g., mysite.com)
 * - Workspace subdomains (e.g., myworkspace.bffless.app)
 * - Preview alias subdomains (e.g., abc123.myworkspace.workspace.bffless.app)
 *
 * These endpoints are namespaced under /_bffless/auth/ to avoid collision with
 * user application routes.
 *
 * Auth strategy (in order of priority):
 * 1. bffless_access cookie (custom domain JWT) — used on true custom domains
 *    where SuperTokens cookies aren't available (different domain)
 * 2. sAccessToken cookie (SuperTokens session) — fallback for workspace subdomains
 *    where the SuperTokens cookie is available on the same parent domain
 */
@ApiTags('Custom Domain Authentication')
@Controller('_bffless/auth')
// Routes here enforce project membership inline (Phase A: signin/signup,
// Phase B: /session via `userHasProjectMembership`). Bypass the global Phase C
// guard so those controlled response shapes (`{ authenticated: false, user: null }`,
// 401 with the same message used for wrong credentials) survive.
@PublicProjectAccess()
export class CustomDomainAuthController {
  private readonly logger = new Logger(CustomDomainAuthController.name);

  constructor(
    private readonly domainTokenService: DomainTokenService,
    private readonly customDomainAuthService: CustomDomainAuthService,
    private readonly authService: AuthService,
    private readonly setupService: SetupService,
    private readonly featureFlagsService: FeatureFlagsService,
    private readonly emailService: EmailService,
    private readonly projectResolver: ProjectResolverService,
    private readonly permissions: PermissionsService,
    private readonly oidcProvidersService: OidcProvidersService,
  ) {}

  /**
   * Resolve the project (when REQUIRE_PROJECT_MEMBERSHIP is on) for the
   * inbound request. Returns null when the master switch is off, when the
   * request comes from the admin domain, or when the hostname doesn't map
   * to a project.
   */
  private async resolveGatedProject(req: Request): Promise<Project | null> {
    if (!(await this.featureFlagsService.isEnabled('REQUIRE_PROJECT_MEMBERSHIP'))) {
      return null;
    }
    return this.projectResolver.resolveProjectFromRequest(req);
  }

  /**
   * True when the user passes the project-membership gate for this request.
   * Returns true (pass) when the master switch is off OR the hostname doesn't
   * resolve to a project (admin/legacy flow). Used by /session to refuse to
   * expose a signed-in user on sites they have no membership in.
   */
  private async userHasProjectMembership(req: Request, userId: string): Promise<boolean> {
    const project = await this.resolveGatedProject(req);
    if (!project) return true;
    const role = await this.permissions.getUserProjectRole(userId, project.id);
    return Boolean(role);
  }

  private getTenantId(): string {
    const isMultiTenant = process.env.SUPERTOKENS_MULTI_TENANT === 'true';
    return isMultiTenant
      ? process.env.ORGANIZATION_ID || process.env.TENANT_ID || 'public'
      : 'public';
  }

  private getRequestHost(req: Request): { hostname: string; origin: string; secure: boolean } {
    const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || '';
    const hostname = host.split(':')[0];
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
    const protocol = isLocalhost ? 'http' : 'https';
    return { hostname, origin: `${protocol}://${host}`, secure: !isLocalhost };
  }

  private async issueDomainSession(
    res: Response,
    user: { id: string; email: string; role: string },
    hostname: string,
    secure: boolean,
  ): Promise<void> {
    const accessToken = this.customDomainAuthService.createAccessToken(
      user.id,
      user.email,
      user.role,
      hostname,
    );
    const refreshToken = this.customDomainAuthService.createRefreshToken(user.id, hostname);
    this.customDomainAuthService.setAuthCookies(res, accessToken, refreshToken, secure);
  }

  /**
   * Callback endpoint for domain authentication relay.
   * Exchanges a domain token for access/refresh cookies on the custom domain.
   */
  @Get('callback')
  @ApiOperation({
    summary: 'Exchange domain token for auth cookies',
    description:
      'Validates a domain relay token, creates access and refresh tokens, sets cookies, and redirects to the original path.',
  })
  @ApiQuery({
    name: 'token',
    description: 'The domain relay token from the workspace domain',
    required: true,
  })
  @ApiQuery({
    name: 'redirect',
    description: 'Path to redirect to after authentication (optional)',
    required: false,
  })
  @ApiResponse({ status: 302, description: 'Redirects to the target path after setting cookies' })
  @ApiResponse({ status: 400, description: 'Invalid or missing token' })
  @ApiResponse({ status: 401, description: 'Token validation failed or user not found' })
  async callback(
    @Query('token') token: string,
    @Query('redirect') redirect: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!token) {
      throw new BadRequestException('Token is required');
    }

    // Verify the domain token
    const payload = this.domainTokenService.verifyDomainToken(token);
    if (!payload) {
      throw new UnauthorizedException('Invalid or expired domain token');
    }

    // Verify the target domain matches the current request host
    // Skip check for localhost tokens (proxied from local dev servers)
    const isLocalhostToken =
      payload.targetDomain === 'localhost' || payload.targetDomain === '127.0.0.1';
    if (!isLocalhostToken) {
      const host = (req.headers['x-forwarded-host'] as string) || req.headers.host;
      const requestDomain = host?.split(':')[0]; // Remove port if present

      if (requestDomain !== payload.targetDomain) {
        this.logger.warn(
          `Domain mismatch: token for ${payload.targetDomain}, request from ${requestDomain}`,
        );
        throw new UnauthorizedException('Token not valid for this domain');
      }
    }

    // Verify user still exists in the database
    const user = await this.authService.getUserById(payload.sub);
    if (!user) {
      this.logger.warn(`User ${payload.sub} not found in database`);
      throw new UnauthorizedException('User not found');
    }

    // Check if user is disabled
    if (user.disabled) {
      this.logger.warn(`User ${payload.sub} is disabled`);
      throw new UnauthorizedException('User account is disabled');
    }

    // Create access and refresh tokens for this custom domain
    const accessToken = this.customDomainAuthService.createAccessToken(
      user.id,
      user.email,
      user.role,
      payload.targetDomain,
    );

    const refreshToken = this.customDomainAuthService.createRefreshToken(
      user.id,
      payload.targetDomain,
    );

    // Use secure cookies for custom domains (they should always be HTTPS)
    // Skip Secure flag for localhost dev (http)
    const secure = !isLocalhostToken;

    // Set auth cookies
    this.customDomainAuthService.setAuthCookies(res, accessToken, refreshToken, secure);

    // Redirect to the original path
    const redirectPath = redirect || payload.redirectPath || '/';

    this.logger.log(
      `Authenticated user ${user.id} on custom domain ${payload.targetDomain}, redirecting to ${redirectPath}`,
    );

    res.redirect(302, redirectPath);
  }

  /**
   * Refresh endpoint for custom domain authentication.
   * Uses the refresh token to create a new access token.
   */
  @Post('refresh')
  @ApiOperation({
    summary: 'Refresh access token',
    description:
      'Validates the refresh token cookie and issues a new access token. The refresh token is sent automatically via cookie.',
  })
  @ApiResponse({ status: 200, description: 'Access token refreshed successfully' })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  async refresh(@Req() req: Request, @Res() res: Response): Promise<void> {
    const refreshToken = req.cookies?.[CustomDomainAuthService.REFRESH_COOKIE_NAME];

    if (!refreshToken) {
      throw new UnauthorizedException('No refresh token provided');
    }

    // Validate the refresh token
    const payload = this.customDomainAuthService.validateRefreshToken(refreshToken);
    if (!payload) {
      // Clear invalid cookies
      // Always use secure cookies for custom domains
      this.customDomainAuthService.clearAuthCookies(res, true);
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Verify the domain matches
    // Skip for localhost tokens (proxied from local dev servers)
    const isLocalhostDomain = payload.domain === 'localhost' || payload.domain === '127.0.0.1';
    if (!isLocalhostDomain) {
      const host = (req.headers['x-forwarded-host'] as string) || req.headers.host;
      const requestDomain = host?.split(':')[0];

      if (requestDomain !== payload.domain) {
        this.logger.warn(
          `Domain mismatch on refresh: token for ${payload.domain}, request from ${requestDomain}`,
        );
        throw new UnauthorizedException('Refresh token not valid for this domain');
      }
    }

    // Verify user still exists and is authorized
    const user = await this.authService.getUserById(payload.sub);
    if (!user) {
      this.logger.warn(`User ${payload.sub} not found during refresh`);
      // Always use secure cookies for custom domains
      this.customDomainAuthService.clearAuthCookies(res, true);
      throw new UnauthorizedException('User not found');
    }

    // Check if user is disabled
    if (user.disabled) {
      this.logger.warn(`User ${payload.sub} is disabled during refresh`);
      // Always use secure cookies for custom domains
      this.customDomainAuthService.clearAuthCookies(res, true);
      throw new UnauthorizedException('User account is disabled');
    }

    // Create new access token with current user data
    const accessToken = this.customDomainAuthService.createAccessToken(
      user.id,
      user.email,
      user.role,
      payload.domain,
    );

    // Set the new access cookie (skip Secure for localhost dev)
    res.cookie(CustomDomainAuthService.ACCESS_COOKIE_NAME, accessToken, {
      maxAge: this.customDomainAuthService.getAccessTokenExpiry() * 1000,
      httpOnly: true,
      secure: !isLocalhostDomain,
      sameSite: 'lax',
      path: '/',
    });

    this.logger.debug(`Refreshed access token for user ${user.id} on domain ${payload.domain}`);

    res.status(200).json({ message: 'Token refreshed successfully' });
  }

  /**
   * Logout endpoint for custom domain authentication.
   * Clears the auth cookies.
   */
  @Post('logout')
  @ApiOperation({
    summary: 'Logout from custom domain',
    description: 'Clears the authentication cookies for the custom domain.',
  })
  @ApiResponse({ status: 200, description: 'Logged out successfully' })
  async logout(@Req() req: Request, @Res() res: Response): Promise<void> {
    // Always use secure cookies for custom domains
    this.customDomainAuthService.clearAuthCookies(res, true);

    this.logger.debug('Cleared auth cookies for custom domain logout');

    res.status(200).json({ message: 'Logged out successfully' });
  }

  /**
   * Session endpoint for custom domain authentication.
   * Returns the current user's session info from the access token cookie.
   */
  @Get('session')
  @ApiOperation({
    summary: 'Get current session information',
    description:
      'Returns user info from the bffless_access cookie. Does not require SuperTokens session.',
  })
  @ApiResponse({
    status: 200,
    description: 'Session information retrieved',
    schema: {
      type: 'object',
      properties: {
        authenticated: { type: 'boolean' },
        user: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            role: { type: 'string' },
          },
        },
      },
    },
  })
  async session(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{
    authenticated: boolean;
    user: { id: string; email: string; role: string } | null;
  }> {
    const accessToken = req.cookies?.[CustomDomainAuthService.ACCESS_COOKIE_NAME];

    if (!accessToken) {
      // No custom domain cookie — fall back to SuperTokens session (sAccessToken).
      // This handles workspace subdomains where the SuperTokens cookie is available
      // on the same parent domain but no bffless_access cookie has been issued.
      return this.trySupertokensSession(req, res);
    }

    // Validate the access token
    const payload = this.customDomainAuthService.validateAccessToken(accessToken);
    if (!payload) {
      // If the token is expired (not invalid), tell the client to try refreshing
      // Use res.status().json() to match the exact SuperTokens format
      if (this.customDomainAuthService.isAccessTokenExpired(accessToken)) {
        res.status(401).json({ message: 'try refresh token' });
        return undefined as any;
      }
      return { authenticated: false, user: null };
    }

    // Verify the domain matches the current request
    // Skip for localhost tokens (proxied from local dev servers)
    const isLocalhostDomain = payload.domain === 'localhost' || payload.domain === '127.0.0.1';
    if (!isLocalhostDomain) {
      const host = (req.headers['x-forwarded-host'] as string) || req.headers.host;
      const requestDomain = host?.split(':')[0];

      if (requestDomain !== payload.domain) {
        this.logger.warn(
          `Domain mismatch on session: token for ${payload.domain}, request from ${requestDomain}`,
        );
        return { authenticated: false, user: null };
      }
    }

    if (!(await this.userHasProjectMembership(req, payload.sub))) {
      return { authenticated: false, user: null };
    }

    return {
      authenticated: true,
      user: {
        id: payload.sub,
        email: payload.email,
        role: payload.role,
      },
    };
  }

  /**
   * Fall back to SuperTokens session verification.
   * Used when no bffless_access cookie is present but the user may have
   * a valid sAccessToken (e.g., on workspace subdomains).
   */
  private async trySupertokensSession(
    req: Request,
    res: Response,
  ): Promise<{ authenticated: boolean; user: { id: string; email: string; role: string } | null }> {
    try {
      const session: SessionContainer | undefined = await getSession(req, res, {
        sessionRequired: false,
      });

      if (!session) {
        return { authenticated: false, user: null };
      }

      const userId = session.getUserId();
      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

      if (!user) {
        return { authenticated: false, user: null };
      }

      if (!(await this.userHasProjectMembership(req, user.id))) {
        return { authenticated: false, user: null };
      }

      return {
        authenticated: true,
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
        },
      };
    } catch {
      return { authenticated: false, user: null };
    }
  }

  // ==========================================================================
  // In-page auth flow (used by AuthDialog on custom domains)
  //
  // These endpoints wrap SuperTokens recipes server-side and mint
  // domain-scoped JWT cookies on the request hostname. They exist because
  // SuperTokens' HTTP middleware is bound to bffless.app and would reject
  // POSTs originating from a non-bffless.app origin. The recipe layer
  // (EmailPassword.signIn etc.) has no such binding.
  //
  // Email links (reset, verification) are constructed to point back to the
  // originating domain at /?bffless_reset=<token> or /?bffless_verify=<token>,
  // so the AuthDialog mounted on the user's site can pick them up.
  // ==========================================================================

  @Post('signin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in (in-page, custom domain)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        email: { type: 'string', format: 'email' },
        password: { type: 'string' },
      },
      required: ['email', 'password'],
    },
  })
  async signIn(
    @Body() body: { email: string; password: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { email, password } = body || {};
    if (!email || !password) {
      throw new BadRequestException('Email and password are required');
    }

    const tenantId = this.getTenantId();
    const signInResponse = await EmailPassword.signIn(tenantId, email, password);

    if (signInResponse.status === 'WRONG_CREDENTIALS_ERROR') {
      return { status: 'WRONG_CREDENTIALS_ERROR' };
    }
    if (signInResponse.status !== 'OK') {
      throw new UnauthorizedException('Failed to sign in');
    }

    const userId = signInResponse.recipeUserId.getAsString();
    let user = await this.authService.getUserByEmail(email);
    if (!user) {
      user = await this.authService.getUserById(userId);
    }
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    if (user.disabled) {
      throw new UnauthorizedException('User account is disabled');
    }

    const project = await this.resolveGatedProject(req);
    if (project) {
      const role = await this.permissions.getUserProjectRole(user.id, project.id);
      if (!role) {
        // Opaque to client — same shape as wrong credentials so we don't leak
        // whether this email has an account on a sister site.
        return { status: 'WRONG_CREDENTIALS_ERROR' };
      }
    }

    const { hostname, secure } = this.getRequestHost(req);
    await this.issueDomainSession(res, user, hostname, secure);

    return {
      status: 'OK',
      user: { id: user.id, email: user.email, role: user.role },
    };
  }

  /**
   * Mint a content-domain session from a project API key.
   *
   * The API-key counterpart of `signin`: instead of email+password, the caller
   * presents an `X-API-Key`, and we mint `bffless_access` / `bffless_refresh`
   * for the key's owner on the requesting host. Intended for headless automation
   * (e.g. a `localhost` dev server driven by Playwright) that already holds a
   * project key but has no password — so it can render login-gated SPA routes
   * without seeding a cookie or storing credentials.
   *
   * `localhost` is cross-origin to the primary domain, so a SuperTokens
   * `sAccessToken` can never reach it; the relay's self-signed `bffless_access`
   * is the only cookie that works there. This path is SuperTokens-independent.
   * The session carries the key owner's *actual* role — no elevation; it is
   * exactly "log in as the key's owner, without their password". Acceptable
   * because the key already authenticates `/api/*` as that owner. See CE
   * `docs/adr/0001-api-key-mints-custom-domain-session.md`.
   */
  @Post('session-from-key')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mint a content-domain session from a project API key',
    description:
      'Authenticates via the X-API-Key header and sets bffless_access / bffless_refresh ' +
      'cookies for the key owner on the requesting host. SuperTokens is not involved. ' +
      'See CE ADR-0001.',
  })
  @ApiHeader({ name: 'X-API-Key', description: 'A project (or global) API key', required: true })
  @ApiResponse({ status: 200, description: 'Session minted; sets auth cookies' })
  @ApiResponse({
    status: 401,
    description: 'Missing/invalid key, or the key owner is not a member of this site',
  })
  async sessionFromKey(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    // ApiKeyGuard also falls back to SuperTokens session auth when no key is
    // present; this endpoint is specifically the API-key bridge, so require the
    // key path (the guard sets `apiKeyId` only on the API-key branch).
    const apiUser = (req as unknown as { user?: { id?: string; apiKeyId?: string } }).user;
    if (!apiUser?.id || !apiUser.apiKeyId) {
      throw new UnauthorizedException('A valid X-API-Key is required');
    }

    const user = await this.authService.getUserById(apiUser.id);
    if (!user) {
      throw new UnauthorizedException('API key owner not found');
    }
    if (user.disabled) {
      throw new UnauthorizedException('User account is disabled');
    }

    // Same membership gate as the password signin: when REQUIRE_PROJECT_MEMBERSHIP
    // is on and the host maps to a project, the key owner must be a member.
    const project = await this.resolveGatedProject(req);
    if (project) {
      const role = await this.permissions.getUserProjectRole(user.id, project.id);
      if (!role) {
        throw new UnauthorizedException('API key owner is not a member of this site');
      }
    }

    const { hostname, secure } = this.getRequestHost(req);
    await this.issueDomainSession(res, user, hostname, secure);

    return {
      status: 'OK',
      user: { id: user.id, email: user.email, role: user.role },
    };
  }

  @Post('signup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign up (in-page, custom domain)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        email: { type: 'string', format: 'email' },
        password: { type: 'string', minLength: 8 },
      },
      required: ['email', 'password'],
    },
  })
  async signUp(
    @Body() body: { email: string; password: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { email, password } = body || {};
    if (!email || !password) {
      throw new BadRequestException('Email and password are required');
    }
    if (password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters long');
    }

    if (!(await this.setupService.isRegistrationFeatureEnabled())) {
      throw new BadRequestException('Registration is currently disabled');
    }
    if (!(await this.setupService.canPublicSignup())) {
      throw new BadRequestException('Public registration is not available');
    }

    // Project-level public-signup gate. When the master switch is on AND the
    // request resolves to a project AND that project hasn't opted into public
    // signups, refuse. Returned as a status string (consistent with the
    // controller's other shape-based responses) so the in-page AuthDialog can
    // render a friendly message without parsing an exception.
    const project = await this.resolveGatedProject(req);
    if (project && !project.allowPublicSignup) {
      return { status: 'PUBLIC_SIGNUP_DISABLED' };
    }

    const tenantId = this.getTenantId();
    const signUpResponse = await EmailPassword.signUp(tenantId, email, password);

    if (signUpResponse.status === 'EMAIL_ALREADY_EXISTS_ERROR') {
      // Smart existing-email fallback: when public signups are allowed on this
      // project AND the visitor knows the password to an existing platform
      // account, silently grant guest membership and sign them in. This is the
      // identity-provider model — one BFFless Auth account, many sites.
      // Wrong-password case still reports EMAIL_ALREADY_EXISTS_ERROR so the
      // AuthDialog can offer to switch to the sign-in tab.
      if (project) {
        const verifyResponse = await EmailPassword.signIn(tenantId, email, password);
        if (verifyResponse.status === 'OK') {
          const stUserId = verifyResponse.recipeUserId.getAsString();
          let user = await this.authService.getUserByEmail(email);
          if (!user) {
            user = await this.authService.getUserById(stUserId);
          }
          if (!user) {
            // Orphan: SuperTokens has the identity but this workspace's `users`
            // table doesn't. Happens when the email exists from another
            // workspace sharing the same SuperTokens core, or the row was
            // deleted app-side. Backfill using the verified SuperTokens id so
            // the membership grant has something to point at. Mirrors the
            // admin-side orphan re-create in auth.controller.ts:signUp.
            const role: 'admin' | 'user' | 'member' =
              email === process.env.ADMIN_EMAIL ? 'admin' : 'member';
            user = await this.authService.createUser(email, role, stUserId);
          }
          if (user && !user.disabled) {
            await this.permissions.grantSystemPermission(project.id, user.id, 'guest');
            const { hostname, secure } = this.getRequestHost(req);
            await this.issueDomainSession(res, user, hostname, secure);
            return {
              status: 'OK',
              user: { id: user.id, email: user.email, role: user.role },
              emailVerificationRequired: false,
            };
          }
        }
      }
      return { status: 'EMAIL_ALREADY_EXISTS_ERROR' };
    }
    if (signUpResponse.status !== 'OK') {
      throw new BadRequestException('Failed to create user');
    }

    const userId = signUpResponse.recipeUserId.getAsString();
    const role: 'admin' | 'user' | 'member' =
      email === process.env.ADMIN_EMAIL ? 'admin' : 'member';
    const dbUser = await this.authService.createUser(email, role, userId);

    if (project) {
      try {
        await this.permissions.grantSystemPermission(project.id, dbUser.id, 'guest');
      } catch (err) {
        this.logger.error('[in-page signup] Failed to auto-grant guest membership', err);
      }
    }

    const verificationRequired = await this.featureFlagsService.isEnabled(
      'ENABLE_EMAIL_VERIFICATION',
    );

    const { hostname, origin, secure } = this.getRequestHost(req);

    if (verificationRequired) {
      try {
        const tokenResponse = await EmailVerification.createEmailVerificationToken(
          tenantId,
          new RecipeUserId(userId),
          email,
        );
        if (tokenResponse.status === 'OK') {
          const verifyLink = `${origin}/?bffless_verify=${encodeURIComponent(tokenResponse.token)}`;
          await this.emailService.sendVerificationEmail(email, verifyLink);
          this.logger.log(`[in-page signup] Sent verification email for ${email}`);
        }
      } catch (err) {
        this.logger.error('[in-page signup] Failed to send verification email', err);
      }
    } else {
      await this.issueDomainSession(
        res,
        { id: dbUser.id, email: dbUser.email, role: dbUser.role },
        hostname,
        secure,
      );
    }

    return {
      status: 'OK',
      user: { id: dbUser.id, email: dbUser.email, role: dbUser.role },
      emailVerificationRequired: verificationRequired,
    };
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request password reset (in-page, custom domain)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { email: { type: 'string', format: 'email' } },
      required: ['email'],
    },
  })
  async forgotPassword(@Body() body: { email: string }, @Req() req: Request) {
    const { email } = body || {};
    if (!email) {
      throw new BadRequestException('Email is required');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('Invalid email format');
    }

    try {
      const user = await this.authService.getUserByEmail(email);
      if (user) {
        const tenantId = this.getTenantId();
        const tokenResponse = await EmailPassword.createResetPasswordToken(
          tenantId,
          user.id,
          email,
        );
        if (tokenResponse.status === 'OK') {
          const { origin } = this.getRequestHost(req);
          const resetLink = `${origin}/?bffless_reset=${encodeURIComponent(tokenResponse.token)}`;
          await this.emailService.sendPasswordResetEmail(email, resetLink);
          this.logger.log(`[in-page forgot] Sent reset email for ${email}`);
        }
      }
    } catch (err) {
      this.logger.error('[in-page forgot] Failed to send reset email', err);
    }

    return {
      status: 'OK',
      message:
        'If an account exists with that email, a password reset link has been sent. Please check your inbox.',
    };
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password using token (in-page, custom domain)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        token: { type: 'string' },
        password: { type: 'string', minLength: 8 },
      },
      required: ['token', 'password'],
    },
  })
  async resetPassword(
    @Body() body: { token: string; password: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, password } = body || {};
    if (!token || !password) {
      throw new BadRequestException('Token and password are required');
    }
    if (password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters long');
    }

    const tenantId = this.getTenantId();
    const response = await EmailPassword.resetPasswordUsingToken(tenantId, token, password);

    if (response.status === 'RESET_PASSWORD_INVALID_TOKEN_ERROR') {
      return { status: 'RESET_PASSWORD_INVALID_TOKEN_ERROR' };
    }
    if (response.status !== 'OK') {
      throw new BadRequestException('Failed to reset password');
    }

    const userId = (response as { userId?: string }).userId;
    if (userId) {
      const user = await this.authService.getUserById(userId);
      if (user && !user.disabled) {
        const { hostname, secure } = this.getRequestHost(req);
        await this.issueDomainSession(res, user, hostname, secure);
        return {
          status: 'OK',
          user: { id: user.id, email: user.email, role: user.role },
        };
      }
    }

    return { status: 'OK' };
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify email using token (in-page, custom domain)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { token: { type: 'string' } },
      required: ['token'],
    },
  })
  async verifyEmail(
    @Body() body: { token: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token } = body || {};
    if (!token) {
      throw new BadRequestException('Token is required');
    }

    const tenantId = this.getTenantId();
    const response = await EmailVerification.verifyEmailUsingToken(tenantId, token);

    if (response.status === 'EMAIL_VERIFICATION_INVALID_TOKEN_ERROR') {
      return { status: 'EMAIL_VERIFICATION_INVALID_TOKEN_ERROR' };
    }
    if (response.status !== 'OK') {
      throw new BadRequestException('Failed to verify email');
    }

    const verifiedUserId = response.user.recipeUserId.getAsString();
    const user = await this.authService.getUserById(verifiedUserId);
    if (user && !user.disabled) {
      const { hostname, secure } = this.getRequestHost(req);
      await this.issueDomainSession(res, user, hostname, secure);
      return {
        status: 'OK',
        user: { id: user.id, email: user.email, role: user.role },
      };
    }

    return { status: 'OK' };
  }

  @Post('send-verification-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend verification email (in-page, custom domain)' })
  async sendVerificationEmail(@Req() req: Request) {
    const accessToken = req.cookies?.[CustomDomainAuthService.ACCESS_COOKIE_NAME];
    if (!accessToken) {
      throw new UnauthorizedException('Not authenticated');
    }
    const payload = this.customDomainAuthService.validateAccessToken(accessToken);
    if (!payload) {
      throw new UnauthorizedException('Invalid session');
    }

    const tenantId = this.getTenantId();
    const recipeUserId = new RecipeUserId(payload.sub);

    if (await EmailVerification.isEmailVerified(recipeUserId)) {
      return { status: 'OK', alreadyVerified: true };
    }

    const tokenResponse = await EmailVerification.createEmailVerificationToken(
      tenantId,
      recipeUserId,
      payload.email,
    );
    if (tokenResponse.status !== 'OK') {
      return { status: 'OK', alreadyVerified: true };
    }

    const { origin } = this.getRequestHost(req);
    const verifyLink = `${origin}/?bffless_verify=${encodeURIComponent(tokenResponse.token)}`;
    await this.emailService.sendVerificationEmail(payload.email, verifyLink);

    return { status: 'OK' };
  }

  @Get('login-methods')
  @ApiOperation({
    summary: 'Get site auth capabilities (custom domain)',
    description:
      'Public endpoint. Returns which auth providers are enabled for this workspace, ' +
      'and (when REQUIRE_PROJECT_MEMBERSHIP is on and the hostname maps to a project) ' +
      'whether public signups are allowed for that project. Used by AuthDialog to decide ' +
      'which tabs to render.',
  })
  async getLoginMethods(@Req() req: Request) {
    return buildLoginMethodsResponse({
      featureFlagsService: this.featureFlagsService,
      setupService: this.setupService,
      projectResolver: this.projectResolver,
      oidcProvidersService: this.oidcProvidersService,
      req,
    });
  }

  @Post('check-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check if email exists (in-page, custom domain)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { email: { type: 'string', format: 'email' } },
      required: ['email'],
    },
  })
  async checkEmail(@Body() body: { email: string }): Promise<{ exists: boolean }> {
    const { email } = body || {};
    if (!email) {
      throw new BadRequestException('Email is required');
    }
    const tenantId = this.getTenantId();
    try {
      const stUsers = await listUsersByAccountInfo(tenantId, { email });
      return { exists: stUsers.length > 0 };
    } catch {
      return { exists: false };
    }
  }
}
