import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  Res,
  Query,
  Param,
  HttpCode,
  HttpStatus,
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiQuery } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { SessionAuthGuard } from './session-auth.guard';
import { SkipEmailVerification } from './decorators/skip-email-verification.decorator';
import { SetupService } from '../setup/setup.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { OnboardingExecutorService } from '../onboarding-rules/onboarding-executor.service';
import { DomainTokenService } from './domain-token.service';
import { ProjectInviteLinksService } from '../project-invite-links/project-invite-links.service';
import { ProjectResolverService } from './project-resolver.service';
import { PermissionsService } from '../permissions/permissions.service';
import { OidcProvidersService } from '../settings/oidc-providers.service';
import { PublicProjectAccess } from './decorators/public-project-access.decorator';
import { buildLoginMethodsResponse } from './login-methods.helper';
import { TENANT_ID } from './supertokens.config';
import { CreateDomainTokenDto } from './dto/create-domain-token.dto';
import { db } from '../db/client';
import { workspaceInvitations, domainMappings, users } from '../db/schema';
import { eq, and, isNull, gt } from 'drizzle-orm';
import EmailPassword from 'supertokens-node/recipe/emailpassword';
import EmailVerification from 'supertokens-node/recipe/emailverification';
import ThirdParty from 'supertokens-node/recipe/thirdparty';
import Multitenancy from 'supertokens-node/recipe/multitenancy';
import Session from 'supertokens-node/recipe/session';
import { SessionContainer } from 'supertokens-node/recipe/session';
import { RecipeUserId } from 'supertokens-node';
import { getUser, listUsersByAccountInfo } from 'supertokens-node';
import { getUserContext } from 'supertokens-node/lib/build/utils';

interface SignUpDto {
  email: string;
  password: string;
  redirect?: string;
  projectInviteToken?: string;
}

interface SignInDto {
  email: string;
  password: string;
  projectInviteToken?: string;
}

interface CheckEmailDto {
  email: string;
}

interface ForgotPasswordDto {
  email: string;
}

interface ResetPasswordDto {
  token: string;
  password: string;
}

interface ChangePasswordDto {
  currentPassword: string;
  newPassword: string;
}

@ApiTags('Authentication')
@Controller('api/auth')
// AuthController routes enforce project membership inline (Phase A: signin/signup,
// Phase B: getSession returns `{ user: null }`). Bypass the global Phase C guard
// so those controlled response shapes aren't pre-empted by a 403.
@PublicProjectAccess()
export class AuthController {
  private readonly logger = new (require('@nestjs/common').Logger)(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly setupService: SetupService,
    private readonly featureFlagsService: FeatureFlagsService,
    private readonly onboardingExecutorService: OnboardingExecutorService,
    private readonly domainTokenService: DomainTokenService,
    private readonly projectInviteLinksService: ProjectInviteLinksService,
    private readonly projectResolver: ProjectResolverService,
    private readonly permissions: PermissionsService,
    private readonly oidcProvidersService: OidcProvidersService,
  ) {}

  private getTenantId(): string {
    const isMultiTenant = process.env.SUPERTOKENS_MULTI_TENANT === 'true';
    return isMultiTenant
      ? process.env.ORGANIZATION_ID || process.env.TENANT_ID || 'public'
      : 'public';
  }

  private async isEmailVerificationRequired(): Promise<boolean> {
    return this.featureFlagsService.isEnabled('ENABLE_EMAIL_VERIFICATION');
  }

  /**
   * Resolve the origin used to rewrite verify/reset email links to the
   * correct admin host. Headers are the primary source — but when the
   * request comes through a proxy chain that strips Origin/Referer (e.g.
   * a per-tenant subdomain proxying /api/auth/* to the backend), fall
   * back to the body.redirect URL the client passed. Without this,
   * verify links default to SuperTokens' configured website domain
   * (sites.bffless.app) instead of admin.<workspace>.<domain>.
   */
  private resolveRequestOrigin(req: Request, redirect?: string | null): string | undefined {
    const headerOrigin = (req.headers.origin as string | undefined) || (req.headers.referer as string | undefined);
    if (headerOrigin) return headerOrigin;
    if (redirect) {
      try {
        return new URL(redirect).origin;
      } catch {
        // ignore — invalid redirect URL, return undefined
      }
    }
    return undefined;
  }

  /**
   * If REQUIRE_PROJECT_MEMBERSHIP is enabled and the request resolves to a
   * project, refuse the signin/signup unless the user has a project-permission
   * row. Throws UnauthorizedException with the same opaque message we use for
   * wrong credentials so we don't leak which sister-site accounts exist.
   *
   * No-op when the feature flag is off, when the request comes from the admin
   * domain, or when the hostname doesn't map to a project (workspace-level
   * legacy flow).
   */
  private async enforceProjectMembership(req: Request, userId: string): Promise<void> {
    if (!(await this.featureFlagsService.isEnabled('REQUIRE_PROJECT_MEMBERSHIP'))) {
      return;
    }
    const project = await this.projectResolver.resolveProjectFromRequest(req);
    if (!project) return;
    const role = await this.permissions.getUserProjectRole(userId, project.id);
    if (!role) {
      throw new UnauthorizedException('Invalid email or password');
    }
  }

  /**
   * After a successful signup, auto-grant `guest` membership on the project
   * resolved from the request hostname — but only if the user has no role
   * yet, so we don't downgrade roles granted by an invitation flow that ran
   * earlier in the request.
   *
   * No-op when no project resolves (admin/legacy flow) or when the master
   * switch is off (caller passes `null` for `requestProject`).
   */
  private async autoGrantGuestIfPublicSignup(
    requestProject: { id: string } | null,
    userId: string,
  ): Promise<void> {
    if (!requestProject) return;
    const existingRole = await this.permissions.getUserProjectRole(userId, requestProject.id);
    if (existingRole) return;
    try {
      await this.permissions.grantSystemPermission(requestProject.id, userId, 'guest');
    } catch (err) {
      // Don't fail the signup if the grant fails; log so it can be repaired.
      this.logger.error('[Signup] Failed to auto-grant guest membership:', err);
    }
  }

  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new user' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        email: { type: 'string', format: 'email', example: 'user@example.com' },
        password: { type: 'string', minLength: 8, example: 'SecurePassword123!' },
        redirect: { type: 'string', example: 'https://example.com/', description: 'URL to redirect to after email verification' },
      },
      required: ['email', 'password'],
    },
  })
  @ApiResponse({ status: 201, description: 'User registered successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input or user already exists' })
  @ApiResponse({ status: 403, description: 'Registration is disabled' })
  async signUp(
    @Body() body: SignUpDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { email, password, redirect } = body;

    if (!email || !password) {
      throw new BadRequestException('Email and password are required');
    }

    // Validate password strength
    if (password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters long');
    }

    // Master switch for built-in email/password auth. When off, the workspace
    // is OIDC-only — reject email/password registration entirely.
    if (!(await this.featureFlagsService.isEnabled('ENABLE_EMAIL_PASSWORD'))) {
      throw new ForbiddenException('Email/password sign-up is disabled. Please use single sign-on.');
    }

    // Check registration settings
    // Feature flag is the circuit breaker - if disabled, no registration at all
    if (!(await this.setupService.isRegistrationFeatureEnabled())) {
      throw new BadRequestException('Registration is currently disabled');
    }

    // Check if user has a valid invitation (invited users can always sign up)
    const [invitation] = await db
      .select()
      .from(workspaceInvitations)
      .where(
        and(
          eq(workspaceInvitations.email, email.toLowerCase()),
          isNull(workspaceInvitations.acceptedAt),
          gt(workspaceInvitations.expiresAt, new Date()),
        ),
      )
      .limit(1);

    // If no invitation, check if public signups are allowed
    if (!invitation) {
      const canPublicSignup = await this.setupService.canPublicSignup();
      if (!canPublicSignup) {
        throw new BadRequestException(
          'Public registration is not available. Please contact an administrator for an invitation.',
        );
      }
    }

    // Project-level public-signup gate (REQUIRE_PROJECT_MEMBERSHIP master switch).
    // Resolved once and reused below for the auto-grant after user creation.
    const membershipGateOn = await this.featureFlagsService.isEnabled(
      'REQUIRE_PROJECT_MEMBERSHIP',
    );
    const requestProject = membershipGateOn
      ? await this.projectResolver.resolveProjectFromRequest(req)
      : null;

    if (
      requestProject &&
      !requestProject.allowPublicSignup &&
      !invitation &&
      !body.projectInviteToken
    ) {
      throw new BadRequestException(
        'Public signups are not enabled for this site. Please contact an administrator for an invitation.',
      );
    }

    try {
      // Check if user already exists in our database
      const existingUser = await this.authService.getUserByEmail(email);
      if (existingUser) {
        throw new BadRequestException('Email already exists');
      }

      const tenantId = this.getTenantId();

      // Create user in SuperTokens first (unified ID strategy)
      const signUpResponse = await EmailPassword.signUp(tenantId, email, password);

      if (signUpResponse.status === 'EMAIL_ALREADY_EXISTS_ERROR') {
        // User exists in SuperTokens but not in app DB (orphaned after app-level deletion).
        // Verify their password via signIn, then re-create the app DB record.
        const signInResponse = await EmailPassword.signIn(tenantId, email, password);

        if (signInResponse.status === 'WRONG_CREDENTIALS_ERROR') {
          throw new BadRequestException('Email already exists in authentication system');
        }

        if (signInResponse.status !== 'OK') {
          throw new BadRequestException('Failed to create user');
        }

        const userId = signInResponse.recipeUserId.getAsString();

        let role: 'admin' | 'user' | 'member' = 'member';
        if (email === process.env.ADMIN_EMAIL) {
          role = 'admin';
        } else if (invitation) {
          role = invitation.role as 'admin' | 'user' | 'member';
        }

        const dbUser = await this.authService.createUser(email, role, userId);

        if (invitation) {
          await db
            .update(workspaceInvitations)
            .set({ acceptedAt: new Date(), acceptedUserId: dbUser.id })
            .where(eq(workspaceInvitations.id, invitation.id));
        }

        // Execute onboarding rules for new signup
        try {
          const trigger = invitation ? 'invite_accepted' : 'user_signup';
          await this.onboardingExecutorService.executeRulesForUser({
            userId: dbUser.id,
            userEmail: email,
            trigger,
            invitationRole: invitation?.role,
          });
        } catch (onboardingError) {
          // Log but don't fail signup if onboarding rules fail
          this.logger.error('[Signup] Onboarding rules failed:', onboardingError);
        }

        // Process project invite link if present
        if (body.projectInviteToken) {
          try {
            await this.projectInviteLinksService.redeemForUser(body.projectInviteToken, dbUser.id);
          } catch (inviteError) {
            this.logger.error('[Signup] Project invite link redemption failed:', inviteError);
          }
        }

        await this.autoGrantGuestIfPublicSignup(requestProject, dbUser.id);

        await Session.createNewSession(req, res, tenantId, signInResponse.recipeUserId);

        let emailVerificationRequired = false;
        try {
          emailVerificationRequired = await this.isEmailVerificationRequired();
          if (emailVerificationRequired) {
            const origin = this.resolveRequestOrigin(req, redirect);
            await EmailVerification.sendEmailVerificationEmail(
              tenantId,
              userId,
              signInResponse.recipeUserId,
              email,
              { requestOrigin: origin, redirectUrl: redirect },
            );
          }
        } catch (verifyError) {
          console.error('[Signup] Failed to send verification email:', verifyError);
        }

        return {
          message: 'User registered successfully',
          user: { id: dbUser.id, email },
          emailVerificationRequired,
        };
      }

      if (signUpResponse.status !== 'OK') {
        throw new BadRequestException('Failed to create user');
      }

      // Get the SuperTokens user ID - this will be used as the app user ID (unified ID)
      const userId = signUpResponse.recipeUserId.getAsString();

      // Determine role: admin email > invitation role > default 'member'
      let role: 'admin' | 'user' | 'member' = 'member';
      if (email === process.env.ADMIN_EMAIL) {
        role = 'admin';
      } else if (invitation) {
        // Use the role from the invitation
        role = invitation.role as 'admin' | 'user' | 'member';
      }

      // Create user in our database with the SAME ID as SuperTokens (no mapping needed)
      const dbUser = await this.authService.createUser(email, role, userId);

      // If user was invited, mark the invitation as accepted
      if (invitation) {
        await db
          .update(workspaceInvitations)
          .set({
            acceptedAt: new Date(),
            acceptedUserId: dbUser.id,
          })
          .where(eq(workspaceInvitations.id, invitation.id));
      }

      // Execute onboarding rules for new signup
      try {
        const trigger = invitation ? 'invite_accepted' : 'user_signup';
        await this.onboardingExecutorService.executeRulesForUser({
          userId: dbUser.id,
          userEmail: email,
          trigger,
          invitationRole: invitation?.role,
        });
      } catch (onboardingError) {
        // Log but don't fail signup if onboarding rules fail
        this.logger.error('[Signup] Onboarding rules failed:', onboardingError);
      }

      // Process project invite link if present
      if (body.projectInviteToken) {
        try {
          await this.projectInviteLinksService.redeemForUser(body.projectInviteToken, dbUser.id);
        } catch (inviteError) {
          this.logger.error('[Signup] Project invite link redemption failed:', inviteError);
        }
      }

      await this.autoGrantGuestIfPublicSignup(requestProject, dbUser.id);

      // Create session so user is immediately logged in
      await Session.createNewSession(req, res, tenantId, signUpResponse.recipeUserId);

      // Check if email verification is required and send verification email
      let emailVerificationRequired = false;
      try {
        emailVerificationRequired = await this.isEmailVerificationRequired();
        if (emailVerificationRequired) {
          // If invitation was already accepted during signup, don't redirect back to
          // /invite/{token} after verification — it would show "already accepted" error.
          // Redirect to home instead.
          const verifyRedirect = invitation ? undefined : redirect;
          const origin = this.resolveRequestOrigin(req, verifyRedirect);
          await EmailVerification.sendEmailVerificationEmail(
            tenantId,
            userId,
            signUpResponse.recipeUserId,
            email,
            { requestOrigin: origin, redirectUrl: verifyRedirect },
          );
          console.log('[Signup] Verification email sent for:', email);
        }
      } catch (verifyError) {
        // Don't fail signup if verification email fails to send
        console.error('[Signup] Failed to send verification email:', verifyError);
      }

      return {
        message: 'User registered successfully',
        user: {
          id: dbUser.id,
          email: email,
        },
        emailVerificationRequired,
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      // Log the actual error for debugging
      console.error('Signup error:', error);
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Failed to register user',
      );
    }
  }

  @Post('signin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in a user' })
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
  @ApiResponse({ status: 200, description: 'User signed in successfully' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async signIn(
    @Body() body: SignInDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { email, password } = body;

    if (!email || !password) {
      throw new BadRequestException('Email and password are required');
    }

    // Master switch for built-in email/password auth. When off, the workspace
    // is OIDC-only — reject email/password sign-in.
    if (!(await this.featureFlagsService.isEnabled('ENABLE_EMAIL_PASSWORD'))) {
      throw new ForbiddenException('Email/password sign-in is disabled. Please use single sign-on.');
    }

    try {
      const tenantId = this.getTenantId();

      const signInResponse = await EmailPassword.signIn(tenantId, email, password);

      if (signInResponse.status === 'WRONG_CREDENTIALS_ERROR') {
        throw new UnauthorizedException('Invalid email or password');
      }

      if (signInResponse.status !== 'OK') {
        throw new UnauthorizedException('Failed to sign in');
      }

      await this.enforceProjectMembership(req, signInResponse.recipeUserId.getAsString());

      // Create session with tenant context
      const session = await Session.createNewSession(
        req,
        res,
        tenantId,
        signInResponse.recipeUserId,
      );

      // Get user from database by email (more reliable in multi-workspace scenarios)
      // The session user ID might be a mapped ID from another workspace
      let user = await this.authService.getUserByEmail(email);

      // Fallback to ID lookup for backwards compatibility
      if (!user) {
        const userId = session.getUserId();
        user = await this.authService.getUserById(userId);
      }

      if (!user) {
        // User authenticated with SuperTokens but not in workspace database
        // Check if they have a pending invitation - only allow signin if invited
        const [pendingInvitation] = await db
          .select()
          .from(workspaceInvitations)
          .where(
            and(
              eq(workspaceInvitations.email, email.toLowerCase()),
              isNull(workspaceInvitations.acceptedAt),
              gt(workspaceInvitations.expiresAt, new Date()),
            ),
          )
          .limit(1);

        if (!pendingInvitation) {
          throw new UnauthorizedException('User not found in database');
        }

        // User has pending invitation - allow signin so they can accept it
        return {
          message: 'Signed in successfully',
          user: {
            id: session.getUserId(),
            email: email,
            role: null, // No role until invitation is accepted
          },
          pendingInvitation: {
            token: pendingInvitation.token,
            role: pendingInvitation.role,
          },
        };
      }

      // Add role to JWT access token payload for external validation
      // This allows Control Plane to validate admin access without database lookup.
      // Non-fatal: by this point the session cookies are already attached to the
      // response — the user IS signed in. If the SuperTokens core fails here
      // (e.g. /recipe/session/regenerate erroring), failing the whole signin
      // would report "Login failed" for a login that succeeded, while the client
      // keeps the valid session cookies. CE's own guards read roles from the
      // database; the claim only degrades external JWT validation.
      try {
        await session.mergeIntoAccessTokenPayload({
          role: user.role,
        });
      } catch (mergeError) {
        this.logger.error(
          '[Signin] Failed to add role claim to access token (session is still valid, continuing):',
          mergeError,
        );
      }

      // Process project invite link if present
      if (body.projectInviteToken) {
        try {
          await this.projectInviteLinksService.redeemForUser(body.projectInviteToken, user.id);
        } catch (inviteError) {
          this.logger.error('[Signin] Project invite link redemption failed:', inviteError);
        }
      }

      return {
        message: 'Signed in successfully',
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
        },
      };
    } catch (error) {
      if (error instanceof UnauthorizedException || error instanceof BadRequestException) {
        throw error;
      }
      console.error('[Signin] Unexpected error during signin:', error);
      console.warn(
        '[Signin] If login fails after a backup restore, the SuperTokens database may be out of sync. ' +
        'Check if the user exists in SuperTokens: ' +
        'psql -U postgres -d supertokens -c "SELECT user_id, email FROM emailpassword_users;"',
      );
      throw new UnauthorizedException('Failed to sign in');
    }
  }

  @Get('session')
  @UseGuards(SessionAuthGuard)
  @SkipEmailVerification()
  @ApiOperation({
    summary: 'Get current session information',
    description:
      'Requires session cookies. The SessionAuthGuard verifies the session automatically.',
  })
  @ApiResponse({ status: 200, description: 'Session information retrieved' })
  @ApiResponse({ status: 401, description: 'No active session' })
  async getSession(@Req() req: Request & { session?: SessionContainer }) {
    try {
      if (!req.session) {
        throw new UnauthorizedException('No active session');
      }

      const userId = req.session.getUserId();
      const sessionHandle = req.session.getHandle();

      // Project-membership gate (REQUIRE_PROJECT_MEMBERSHIP master switch).
      // Closes the parent-domain cookie bleed across *.bffless.app: a user with
      // a workspace SuperTokens cookie who lands on a sister site they have no
      // membership in is reported as anonymous here. Cookie is intentionally
      // NOT cleared — it may still be valid for sites where they ARE a member.
      // Runs early so we short-circuit before the more expensive lookups.
      // Admin domain (resolver returns null) and pending-invitation flow on
      // admin domain are unaffected. A pending workspace invitation that
      // somehow lands on a project subdomain is correctly treated as anonymous
      // there (no project membership row exists).
      if (await this.featureFlagsService.isEnabled('REQUIRE_PROJECT_MEMBERSHIP')) {
        const project = await this.projectResolver.resolveProjectFromRequest(req);
        if (project) {
          const role = await this.permissions.getUserProjectRole(userId, project.id);
          if (!role) {
            return {
              session: { userId, handle: sessionHandle },
              user: null,
              emailVerified: false,
              emailVerificationRequired: false,
            };
          }
        }
      }

      // Look up user in our database by user ID
      let user = await this.authService.getUserById(userId);

      // If not found by ID, try by email (multi-workspace scenario)
      // The session user ID might be mapped to an ID from another workspace
      let stUserEmail: string | undefined;
      if (!user) {
        // Get user email from SuperTokens
        const stUser = await getUser(userId);
        if (stUser && stUser.emails && stUser.emails.length > 0) {
          stUserEmail = stUser.emails[0];
          user = await this.authService.getUserByEmail(stUserEmail);
        }
      }

      // If user still not in database, check for pending invitation
      // This allows the session endpoint to return user info for invitation acceptance flow
      if (!user && stUserEmail) {
        const [pendingInvitation] = await db
          .select()
          .from(workspaceInvitations)
          .where(
            and(
              eq(workspaceInvitations.email, stUserEmail.toLowerCase()),
              isNull(workspaceInvitations.acceptedAt),
              gt(workspaceInvitations.expiresAt, new Date()),
            ),
          )
          .limit(1);

        if (pendingInvitation) {
          // Return session with user info from SuperTokens (not from DB)
          return {
            session: {
              userId,
              handle: sessionHandle,
            },
            user: {
              id: userId,
              email: stUserEmail,
              role: null, // No role until invitation accepted
            },
            pendingInvitation: {
              token: pendingInvitation.token,
              role: pendingInvitation.role,
            },
            emailVerified: false,
            emailVerificationRequired: false,
          };
        }
      }

      // Check email verification status
      let emailVerified = true;
      let emailVerificationRequired = false;
      try {
        emailVerificationRequired = await this.isEmailVerificationRequired();
        if (emailVerificationRequired) {
          const recipeUserId = new RecipeUserId(userId);
          emailVerified = await EmailVerification.isEmailVerified(recipeUserId);
        }
      } catch (error) {
        console.error('[Session] Error checking email verification:', error);
      }

      return {
        session: {
          userId,
          handle: sessionHandle,
        },
        user: user
          ? {
              id: user.id,
              email: user.email,
              role: user.role,
            }
          : null,
        emailVerified,
        emailVerificationRequired,
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Failed to get session');
    }
  }

  // Documentation stubs for SuperTokens-handled endpoints
  @Post('signout')
  @HttpCode(HttpStatus.OK)
  @SkipEmailVerification()
  @ApiOperation({
    summary: 'Sign out current user',
    description: 'Handled by SuperTokens. Clears session cookies.',
  })
  @ApiResponse({ status: 200, description: 'User signed out successfully' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async signOut() {
    // SuperTokens middleware handles this automatically
    return { status: 'OK' };
  }

  @Post('session/refresh')
  @HttpCode(HttpStatus.OK)
  @SkipEmailVerification()
  @ApiOperation({
    summary: 'Refresh access token',
    description: 'Handled by SuperTokens. Requires sRefreshToken cookie.',
  })
  @ApiResponse({ status: 200, description: 'Token refreshed successfully' })
  @ApiResponse({ status: 401, description: 'Invalid refresh token' })
  async refreshToken() {
    // SuperTokens middleware handles this automatically
    return { status: 'OK' };
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request password reset email',
    description:
      'Sends a password reset email to the user. Returns success even if email does not exist (security best practice).',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        email: { type: 'string', format: 'email', example: 'user@example.com' },
      },
      required: ['email'],
    },
  })
  @ApiResponse({ status: 200, description: 'Password reset email sent (if email exists)' })
  @ApiResponse({ status: 400, description: 'Invalid email format' })
  async forgotPassword(@Body() body: ForgotPasswordDto, @Req() req: Request) {
    const { email } = body;

    if (!email) {
      throw new BadRequestException('Email is required');
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new BadRequestException('Invalid email format');
    }

    try {
      const tenantId = this.getTenantId();

      // Get user from our database to find the user ID
      const user = await this.authService.getUserByEmail(email);

      if (user) {
        // Capture the origin for constructing the reset link
        // The reset link should always go to admin.<workspace>.<domain>
        // ForgotPasswordDto doesn't carry a redirect — reset flow lands on
        // admin.<workspace>/reset-password and stays there. The fallback is
        // header-only.
        const origin = this.resolveRequestOrigin(req);

        // Use SuperTokens to send password reset email
        // Pass origin in userContext so email delivery can construct the correct URL
        try {
          await EmailPassword.sendResetPasswordEmail(tenantId, user.id, email, {
            requestOrigin: origin,
          });
          console.log('[Password Reset] Reset email sent for:', email);
        } catch (resetError) {
          // This can happen if the user exists in app DB but not in SuperTokens
          // (e.g., after a backup restore where SuperTokens DB wasn't included)
          console.error('[Password Reset] Failed to generate reset link for:', email);
          console.error('[Password Reset] Error:', resetError);
          console.warn(
            '[Password Reset] If the user exists in the app database but not in SuperTokens, ' +
            'you may need to re-create the user in SuperTokens. See container logs for details. ' +
            'You can create the user via the SuperTokens API: ' +
            'curl -X POST http://<supertokens-host>:3567/recipe/signup ' +
            '-H "Content-Type: application/json" -H "rid: emailpassword" ' +
            '-d \'{"email":"<email>","password":"<new-password>"}\'  ' +
            'Then update the user ID in the app database to match.',
          );
        }
      } else {
        console.log('[Password Reset] No user found for email:', email);
      }

      // Always return success (security best practice - don't reveal if email exists)
      return {
        message:
          'If an account exists with that email, a password reset link has been sent. Please check your inbox.',
      };
    } catch (error) {
      console.error('Forgot password error:', error);
      // Still return success to avoid revealing if email exists
      return {
        message:
          'If an account exists with that email, a password reset link has been sent. Please check your inbox.',
      };
    }
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reset password with token',
    description: 'Resets user password using the token from the password reset email.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        token: { type: 'string', example: 'abc123...' },
        password: { type: 'string', minLength: 8, example: 'NewSecurePassword123!' },
      },
      required: ['token', 'password'],
    },
  })
  @ApiResponse({ status: 200, description: 'Password reset successfully' })
  @ApiResponse({ status: 400, description: 'Invalid or expired token, or invalid password' })
  async resetPassword(@Body() body: ResetPasswordDto) {
    const { token, password } = body;

    if (!token || !password) {
      throw new BadRequestException('Token and password are required');
    }

    // Validate password strength
    if (password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters long');
    }

    try {
      const tenantId = this.getTenantId();

      // Consume the reset token and update the password
      const response = await EmailPassword.resetPasswordUsingToken(tenantId, token, password);

      if (response.status === 'RESET_PASSWORD_INVALID_TOKEN_ERROR') {
        throw new BadRequestException('Invalid or expired password reset token');
      }

      if (response.status !== 'OK') {
        throw new BadRequestException('Failed to reset password');
      }

      return {
        message:
          'Password has been reset successfully. You can now sign in with your new password.',
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      console.error('Reset password error:', error);
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Failed to reset password',
      );
    }
  }

  @Post('send-verification-email')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionAuthGuard)
  @SkipEmailVerification()
  @ApiOperation({
    summary: 'Send email verification link',
    description: 'Sends a verification email to the currently logged-in user.',
  })
  @ApiResponse({ status: 200, description: 'Verification email sent' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async sendVerificationEmail(
    @Body() body: { redirect?: string },
    @Req() req: Request & { session?: SessionContainer },
  ) {
    if (!req.session) {
      throw new UnauthorizedException('No active session');
    }

    const userId = req.session.getUserId();
    const recipeUserId = new RecipeUserId(userId);

    // Check if already verified
    const isVerified = await EmailVerification.isEmailVerified(recipeUserId);
    if (isVerified) {
      return { message: 'Already verified', alreadyVerified: true };
    }

    // Get user email
    const stUser = await getUser(userId);
    const email = stUser?.emails?.[0];
    if (!email) {
      throw new BadRequestException('Could not determine user email');
    }

    const tenantId = this.getTenantId();
    const origin = this.resolveRequestOrigin(req, body?.redirect);

    await EmailVerification.sendEmailVerificationEmail(tenantId, userId, recipeUserId, email, {
      requestOrigin: origin,
      redirectUrl: body?.redirect,
    });

    return { message: 'Verification email sent' };
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify email with token',
    description: 'Verifies user email using the token from the verification email.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        token: { type: 'string', example: 'abc123...' },
      },
      required: ['token'],
    },
  })
  @ApiResponse({ status: 200, description: 'Email verified successfully' })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  async verifyEmail(@Body() body: { token: string }) {
    const { token } = body;

    if (!token) {
      throw new BadRequestException('Token is required');
    }

    const tenantId = this.getTenantId();

    const response = await EmailVerification.verifyEmailUsingToken(tenantId, token);

    if (response.status === 'EMAIL_VERIFICATION_INVALID_TOKEN_ERROR') {
      throw new BadRequestException('Invalid or expired verification token');
    }

    if (response.status !== 'OK') {
      throw new BadRequestException('Failed to verify email');
    }

    return { message: 'Email verified successfully' };
  }

  @Post('check-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Check if an email exists in auth system and workspace',
    description:
      'Public endpoint. Checks whether an email is registered in SuperTokens and/or the workspace database.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        email: { type: 'string', format: 'email', example: 'user@example.com' },
      },
      required: ['email'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Email check result',
    schema: {
      type: 'object',
      properties: {
        existsInAuth: { type: 'boolean' },
        existsInWorkspace: { type: 'boolean' },
      },
    },
  })
  async checkEmail(
    @Body() body: CheckEmailDto,
  ): Promise<{ existsInAuth: boolean; existsInWorkspace: boolean }> {
    const { email } = body;

    if (!email) {
      throw new BadRequestException('Email is required');
    }

    const tenantId = this.getTenantId();

    // Check SuperTokens
    let existsInAuth = false;
    try {
      const stUsers = await listUsersByAccountInfo(tenantId, { email });
      existsInAuth = stUsers.length > 0;
    } catch {
      existsInAuth = false;
    }

    // Check app database
    const existingUser = await this.authService.getUserByEmail(email);
    const existsInWorkspace = !!existingUser;

    return { existsInAuth, existsInWorkspace };
  }

  @Get('registration-status')
  @ApiOperation({
    summary: 'Get registration status',
    description:
      'Check if user registration is available. Returns whether public signups are allowed and TOS requirements. Public endpoint.',
  })
  @ApiResponse({
    status: 200,
    description: 'Registration status retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        registrationEnabled: {
          type: 'boolean',
          description: 'Whether registration is enabled at all (feature flag)',
        },
        allowPublicSignups: {
          type: 'boolean',
          description: 'Whether public signups are allowed (invite-only when false)',
        },
        emailPasswordEnabled: {
          type: 'boolean',
          description:
            'Whether built-in email/password sign-in and registration are enabled (ENABLE_EMAIL_PASSWORD). When false the workspace is OIDC-only.',
        },
        requireTosAcceptance: {
          type: 'boolean',
          description: 'Whether users must accept Terms of Service to register',
        },
        tosUrl: {
          type: 'string',
          description: 'URL to the Terms of Service page',
        },
      },
    },
  })
  async getRegistrationStatus(): Promise<{
    registrationEnabled: boolean;
    allowPublicSignups: boolean;
    emailPasswordEnabled: boolean;
    requireTosAcceptance: boolean;
    tosUrl: string;
  }> {
    const registrationSettings = await this.setupService.getRegistrationSettings();
    const emailPasswordEnabled = await this.featureFlagsService.isEnabled('ENABLE_EMAIL_PASSWORD');
    const requireTosAcceptance = await this.featureFlagsService.get('REQUIRE_TOS_ACCEPTANCE');
    const tosUrl = await this.featureFlagsService.get('TOS_URL');

    return {
      ...registrationSettings,
      emailPasswordEnabled,
      requireTosAcceptance: requireTosAcceptance as boolean,
      tosUrl: tosUrl as string,
    };
  }

  @Post('domain-token')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionAuthGuard)
  @SkipEmailVerification()
  @ApiOperation({
    summary: 'Create a domain relay token',
    description:
      'Creates a short-lived token for authenticating on a custom domain. The token can be exchanged for auth cookies on the custom domain callback endpoint.',
  })
  @ApiBody({
    type: CreateDomainTokenDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Domain token created successfully',
    schema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'The domain relay token' },
        redirectUrl: {
          type: 'string',
          description: 'Full URL to redirect to on the custom domain',
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid target domain' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async createDomainToken(
    @Body() body: CreateDomainTokenDto,
    @Req() req: Request & { user?: { id: string; email: string; role: string } },
  ): Promise<{ token: string; redirectUrl: string }> {
    const { targetDomain, redirectPath, targetOrigin } = body;

    // Validate that the target domain belongs to this workspace.
    // Check registered domain mappings (custom or subdomain types),
    // or verify it's a subdomain of the workspace's PRIMARY_DOMAIN.
    const [mapping] = await db
      .select()
      .from(domainMappings)
      .where(
        and(
          eq(domainMappings.domain, targetDomain),
          eq(domainMappings.isActive, true),
        ),
      )
      .limit(1);

    if (!mapping) {
      // Also allow subdomains of PRIMARY_DOMAIN (e.g., preview URLs)
      const primaryDomain = process.env.PRIMARY_DOMAIN;
      const isWorkspaceSubdomain = primaryDomain && targetDomain.endsWith(`.${primaryDomain}`);

      if (!isWorkspaceSubdomain) {
        throw new BadRequestException(
          `Domain '${targetDomain}' is not a registered domain for this workspace`,
        );
      }
    }

    // Get user from request (already authenticated via SessionAuthGuard)
    const user = req.user;
    if (!user) {
      throw new UnauthorizedException('User not found in request');
    }

    // Create the domain token
    const token = this.domainTokenService.createDomainToken(
      user.id,
      user.email,
      user.role,
      targetDomain,
      redirectPath,
    );

    // Build the callback URL
    const callbackPath = '/_bffless/auth/callback';
    const redirectParam = redirectPath ? `&redirect=${encodeURIComponent(redirectPath)}` : '';
    // Only allow targetOrigin override for localhost development
    const isLocalhostDev = targetOrigin && (targetDomain === 'localhost' || targetDomain === '127.0.0.1');
    const origin = isLocalhostDev ? targetOrigin : `https://${targetDomain}`;
    const redirectUrl = `${origin}${callbackPath}?token=${encodeURIComponent(token)}${redirectParam}`;

    this.logger.log(
      `Created domain token for user ${user.id} targeting ${targetDomain}`,
    );

    return { token, redirectUrl };
  }

  @Get('login-methods')
  @ApiOperation({
    summary: 'Get site auth capabilities (workspace subdomain)',
    description:
      'Public endpoint. Returns which auth providers are enabled for this workspace, ' +
      'and (when REQUIRE_PROJECT_MEMBERSHIP is on and the hostname maps to a project) ' +
      'whether public signups are allowed for that project. Used by AuthDialog to decide ' +
      'which tabs to render.',
  })
  async getSiteLoginMethods(@Req() req: Request) {
    return buildLoginMethodsResponse({
      featureFlagsService: this.featureFlagsService,
      setupService: this.setupService,
      projectResolver: this.projectResolver,
      oidcProvidersService: this.oidcProvidersService,
      req,
    });
  }

  @Get('me/login-methods')
  @UseGuards(SessionAuthGuard)
  @ApiOperation({
    summary: 'Get login methods for the current user',
    description:
      'Returns which login methods the user has (e.g., email/password). Used to conditionally show change password UI.',
  })
  @ApiResponse({
    status: 200,
    description: 'Login methods retrieved',
    schema: {
      type: 'object',
      properties: {
        hasPassword: { type: 'boolean', description: 'Whether the user has email/password login' },
        hasGoogle: { type: 'boolean', description: 'Whether the user has linked Google OAuth' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async getMyLoginMethods(@Req() req: Request & { session?: SessionContainer }) {
    if (!req.session) {
      throw new UnauthorizedException('No active session');
    }

    const userId = req.session.getUserId();
    const stUser = await getUser(userId);

    if (!stUser) {
      throw new UnauthorizedException('User not found');
    }

    const hasPassword = stUser.loginMethods.some(
      (method) => method.recipeId === 'emailpassword',
    );

    const hasGoogle = stUser.loginMethods.some(
      (method) => method.recipeId === 'thirdparty' && method.thirdParty?.id === 'google',
    );

    return { hasPassword, hasGoogle };
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionAuthGuard)
  @ApiOperation({
    summary: 'Change password for the current user',
    description:
      'Verifies the current password and updates to a new password. Only works for users with email/password login.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        currentPassword: { type: 'string', example: 'OldPassword123!' },
        newPassword: { type: 'string', minLength: 8, example: 'NewSecurePassword123!' },
      },
      required: ['currentPassword', 'newPassword'],
    },
  })
  @ApiResponse({ status: 200, description: 'Password updated successfully' })
  @ApiResponse({ status: 400, description: 'Incorrect current password or invalid new password' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async changePassword(
    @Body() body: ChangePasswordDto,
    @Req() req: Request & { session?: SessionContainer },
  ) {
    const { currentPassword, newPassword } = body;

    if (!currentPassword || !newPassword) {
      throw new BadRequestException('Current password and new password are required');
    }

    if (newPassword.length < 8) {
      throw new BadRequestException('New password must be at least 8 characters long');
    }

    if (!req.session) {
      throw new UnauthorizedException('No active session');
    }

    const userId = req.session.getUserId();
    const stUser = await getUser(userId);

    if (!stUser) {
      throw new UnauthorizedException('User not found');
    }

    // Find the email/password login method
    const emailPasswordMethod = stUser.loginMethods.find(
      (method) => method.recipeId === 'emailpassword',
    );

    if (!emailPasswordMethod) {
      throw new BadRequestException('User does not have email/password login');
    }

    const email = emailPasswordMethod.email;
    if (!email) {
      throw new BadRequestException('Could not determine user email');
    }

    const tenantId = this.getTenantId();

    // Verify current password by attempting sign-in
    const signInResponse = await EmailPassword.signIn(tenantId, email, currentPassword);

    if (signInResponse.status === 'WRONG_CREDENTIALS_ERROR') {
      throw new BadRequestException('Incorrect current password');
    }

    if (signInResponse.status !== 'OK') {
      throw new BadRequestException('Failed to verify current password');
    }

    // Update password
    const recipeUserId = emailPasswordMethod.recipeUserId;
    const updateResponse = await EmailPassword.updateEmailOrPassword({
      recipeUserId,
      password: newPassword,
    });

    if (updateResponse.status === 'PASSWORD_POLICY_VIOLATED_ERROR') {
      throw new BadRequestException(
        updateResponse.failureReason || 'Password does not meet the required policy',
      );
    }

    if (updateResponse.status !== 'OK') {
      throw new BadRequestException('Failed to update password');
    }

    return { message: 'Password updated successfully' };
  }

  // ==========================================================================
  // OAuth / Third-Party Sign-In
  //
  // Provider-agnostic: each enabled `oidc_providers` row gets routed via
  // /oauth/:providerId/url and /oauth/:providerId/callback. The legacy
  // /oauth/google/* endpoints below forward to :providerId='google' for
  // back-compat with old AuthDialog bundles and CE clients (removed in 0050).
  //
  // Always uses TENANT_ID='public' — see [[feedback-supertokens-single-tenant]].
  // ==========================================================================

  @Get('oauth/providers')
  @ApiOperation({
    summary: 'Get enabled OAuth/OIDC sign-in providers',
    description: 'Public endpoint. Returns the list of enabled providers (Google / Okta / Azure AD / generic OIDC) for rendering sign-in buttons.',
  })
  @ApiResponse({
    status: 200,
    description: 'Enabled providers',
    schema: {
      type: 'object',
      properties: {
        providers: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Provider slug, used as :providerId in /oauth/:providerId/url' },
              kind: { type: 'string', enum: ['google', 'okta', 'azure-ad', 'oidc'] },
              displayName: { type: 'string' },
            },
          },
        },
      },
    },
  })
  async getOAuthProviders(): Promise<{ providers: Array<{ id: string; kind: string; displayName: string }> }> {
    try {
      const masterEnabled = await this.featureFlagsService.isEnabled('ENABLE_OIDC_PROVIDERS');
      if (!masterEnabled) return { providers: [] };
      const providers = await this.oidcProvidersService.listEnabled();
      return { providers };
    } catch (err) {
      this.logger.error('[OAuth] Failed to list providers', err);
      return { providers: [] };
    }
  }

  @Get('oauth/:providerId/url')
  @ApiOperation({
    summary: 'Get OAuth authorization URL for a provider',
    description: 'Public endpoint. Returns the URL to redirect the user to for sign-in via the named provider.',
  })
  @ApiQuery({ name: 'redirectUrl', required: true, description: 'OAuth redirect URI (callback URL)' })
  @ApiResponse({ status: 200, description: 'Provider authorization URL' })
  @ApiResponse({ status: 400, description: 'Provider not configured, not enabled, or feature disabled' })
  async getOAuthUrl(
    @Param('providerId') providerId: string,
    @Query('redirectUrl') redirectUrl: string,
  ): Promise<{ url: string; pkceCodeVerifier?: string }> {
    return this.startOAuthAuthorisationFlow(providerId, redirectUrl);
  }

  private async startOAuthAuthorisationFlow(
    providerId: string,
    redirectUrl: string,
  ): Promise<{ url: string; pkceCodeVerifier?: string }> {
    if (!redirectUrl) {
      throw new BadRequestException('redirectUrl is required');
    }
    if (!(await this.featureFlagsService.isEnabled('ENABLE_OIDC_PROVIDERS'))) {
      throw new BadRequestException('OIDC sign-in is not enabled');
    }
    const row = await this.oidcProvidersService.findByProviderId(providerId);
    if (!row || !row.enabled) {
      throw new BadRequestException(`OIDC provider '${providerId}' is not configured or not enabled`);
    }

    // For kind='google' the SuperTokens thirdPartyId is forced to 'google';
    // for everything else it matches the row's slug. Mirrors the discriminator
    // in supertokens.config.ts:buildSuperTokensConfig.
    const stThirdPartyId = row.kind === 'google' ? 'google' : row.providerId;
    const provider = await ThirdParty.getProvider(TENANT_ID, stThirdPartyId, undefined);
    if (!provider) {
      throw new BadRequestException(
        `OIDC provider '${providerId}' is not registered with SuperTokens — try toggling it off and on, or check backend logs`,
      );
    }

    const result = await provider.getAuthorisationRedirectURL({
      redirectURIOnProviderDashboard: redirectUrl,
      userContext: getUserContext(),
    });
    return {
      url: result.urlWithQueryParams,
      pkceCodeVerifier: result.pkceCodeVerifier,
    };
  }

  @Post('oauth/:providerId/callback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Complete OAuth/OIDC sign-in for a provider',
    description: 'Exchanges OAuth code for tokens, creates/links user, and creates session. Provider-agnostic.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        redirectUrl: { type: 'string', description: 'The redirect URI used in the authorization request' },
        pkceCodeVerifier: { type: 'string' },
        projectInviteToken: { type: 'string' },
      },
      required: ['code', 'redirectUrl'],
    },
  })
  @ApiResponse({ status: 200, description: 'User signed in via the provider' })
  @ApiResponse({ status: 400, description: 'OAuth flow failed' })
  async oauthCallback(
    @Param('providerId') providerId: string,
    @Body() body: { code: string; redirectUrl: string; pkceCodeVerifier?: string; projectInviteToken?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.completeOAuthCallback(providerId, body, req, res);
  }

  private async completeOAuthCallback(
    providerId: string,
    body: { code: string; redirectUrl: string; pkceCodeVerifier?: string; projectInviteToken?: string },
    req: Request,
    res: Response,
  ) {
    const { code, redirectUrl, pkceCodeVerifier } = body;
    if (!code || !redirectUrl) {
      throw new BadRequestException('code and redirectUrl are required');
    }
    if (!(await this.featureFlagsService.isEnabled('ENABLE_OIDC_PROVIDERS'))) {
      throw new BadRequestException('OIDC sign-in is not enabled');
    }

    const row = await this.oidcProvidersService.findByProviderId(providerId);
    if (!row || !row.enabled) {
      throw new BadRequestException(`OIDC provider '${providerId}' is not configured or not enabled`);
    }
    const stThirdPartyId = row.kind === 'google' ? 'google' : row.providerId;
    const providerLabel = row.displayName;

    try {
      const provider = await ThirdParty.getProvider(TENANT_ID, stThirdPartyId, undefined);
      if (!provider) {
        throw new BadRequestException(
          `OIDC provider '${providerId}' is not registered with SuperTokens`,
        );
      }

      const oAuthTokens = await provider.exchangeAuthCodeForOAuthTokens({
        redirectURIInfo: {
          redirectURIOnProviderDashboard: redirectUrl,
          redirectURIQueryParams: { code },
          pkceCodeVerifier,
        },
        userContext: getUserContext(),
      });

      const userInfo = await provider.getUserInfo({
        oAuthTokens,
        userContext: getUserContext(),
      });

      if (!userInfo.email?.id) {
        throw new BadRequestException(`Could not get email from ${providerLabel} account`);
      }
      const email = userInfo.email.id;
      const thirdPartyUserId = userInfo.thirdPartyUserId;

      // isVerified=true: Google + Okta + Azure AD + most OIDC IdPs verify
      // emails before issuing them. If we ever connect to an IdP that doesn't,
      // gate this on userInfo.email.isVerified and add per-kind override.
      const signInUpResponse = await ThirdParty.manuallyCreateOrUpdateUser(
        TENANT_ID,
        stThirdPartyId,
        thirdPartyUserId,
        email,
        true,
      );

      if (signInUpResponse.status !== 'OK') {
        this.logger.error(`[${providerLabel} OAuth] manuallyCreateOrUpdateUser failed:`, signInUpResponse);
        throw new BadRequestException(`Failed to create or link ${providerLabel} user`);
      }

      return await this.completeOAuthSignIn({
        email,
        providerLabel,
        createdNewRecipeUser: signInUpResponse.createdNewRecipeUser,
        // SuperTokens primary user ID. For NEW app users we propagate this as
        // the DB row PK so the unified-ID invariant holds: dbUser.id === a
        // valid SuperTokens recipeUserId. Without this, Session.createNewSession
        // below errors with UNKNOWN_USER_ID.
        supertokensUserId: signInUpResponse.user.id,
        projectInviteToken: body.projectInviteToken,
        req,
        res,
      });
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`[${providerLabel} OAuth] Callback error:`, error);
      throw new BadRequestException(
        error instanceof Error ? error.message : `${providerLabel} sign-in failed`,
      );
    }
  }

  /**
   * Provider-agnostic completion of an OAuth/OIDC sign-in flow. Called by
   * `completeOAuthCallback` after the controller has exchanged the auth code
   * for tokens and resolved IdP user info. Lives on the controller (rather
   * than AuthService) because moving it to AuthService introduces a circular
   * import: roles.guard imports AuthService, AuthService would import
   * SetupService, SetupService transitively pulls cache.controller, which
   * imports roles.guard back. Controllers don't sit in that chain.
   *
   *   1. Look up app DB user by email.
   *   2. If new: check workspace invitation, determine role, enforce the
   *      public-signup gate (unless invited), create the DB user, accept
   *      invitation if present, run onboarding rules.
   *   3. If a project invite token was passed, redeem it.
   *   4. Create a SuperTokens session using the **app DB user's ID** as the
   *      recipeUserId — not the new ThirdParty recipe user ID. When an
   *      existing email/password user signs in via OAuth, SuperTokens issues
   *      a different recipe user; using that ID would desync session.getUserId
   *      from the app DB. Using dbUser.id keeps all downstream lookups working.
   *   5. Merge `role` into the access token payload so guards see it.
   */
  private async completeOAuthSignIn(input: {
    email: string;
    providerLabel: string;
    createdNewRecipeUser: boolean;
    /**
     * SuperTokens primary user ID for this sign-in. When we create a brand-new
     * app DB user, we MUST use this as the row's PK so the session's
     * recipeUserId (set to dbUser.id below) is one SuperTokens already knows
     * about. Skipping this re-introduces UNKNOWN_USER_ID errors on first
     * sign-in via a new IdP.
     */
    supertokensUserId: string;
    projectInviteToken?: string;
    req: Request;
    res: Response;
  }) {
    const { email, providerLabel, createdNewRecipeUser, supertokensUserId, projectInviteToken, req, res } = input;

    let dbUser = await this.authService.getUserByEmail(email);

    if (!dbUser) {
      const [invitation] = await db
        .select()
        .from(workspaceInvitations)
        .where(
          and(
            eq(workspaceInvitations.email, email.toLowerCase()),
            isNull(workspaceInvitations.acceptedAt),
            gt(workspaceInvitations.expiresAt, new Date()),
          ),
        )
        .limit(1);

      let role: 'admin' | 'user' | 'member' = 'member';
      if (email === process.env.ADMIN_EMAIL) {
        role = 'admin';
      } else if (invitation) {
        role = invitation.role as 'admin' | 'user' | 'member';
      }

      if (!invitation) {
        const registrationEnabled = await this.setupService.isRegistrationFeatureEnabled();
        const canPublicSignup = await this.setupService.canPublicSignup();
        if (!registrationEnabled || !canPublicSignup) {
          throw new BadRequestException(
            'Public registration is not available. Please contact an administrator for an invitation.',
          );
        }
      }

      // Pass the SuperTokens user ID so dbUser.id === a recipeUserId
      // SuperTokens recognises — required for Session.createNewSession below.
      dbUser = await this.authService.createUser(email, role, supertokensUserId);

      if (invitation) {
        await db
          .update(workspaceInvitations)
          .set({ acceptedAt: new Date(), acceptedUserId: dbUser.id })
          .where(eq(workspaceInvitations.id, invitation.id));
      }

      try {
        const trigger = invitation ? 'invite_accepted' : 'user_signup';
        await this.onboardingExecutorService.executeRulesForUser({
          userId: dbUser.id,
          userEmail: email,
          trigger,
          invitationRole: invitation?.role,
        });
      } catch (onboardingError) {
        this.logger.error(`[${providerLabel} OAuth] Onboarding rules failed:`, onboardingError);
      }
    }

    if (projectInviteToken && dbUser) {
      try {
        await this.projectInviteLinksService.redeemForUser(projectInviteToken, dbUser.id);
      } catch (inviteError) {
        this.logger.error(
          `[${providerLabel} OAuth] Project invite link redemption failed:`,
          inviteError,
        );
      }
    }

    // Record that this user has proven a working OIDC sign-in. This is the
    // safeguard consulted before email/password login can be disabled via the
    // admin UI (see settings.controller `PATCH auth/email-password`).
    try {
      await db
        .update(users)
        .set({ oidcVerifiedAt: new Date() })
        .where(eq(users.id, dbUser.id));
    } catch (stampError) {
      this.logger.error(
        `[${providerLabel} OAuth] Failed to stamp oidcVerifiedAt:`,
        stampError,
      );
    }

    const sessionRecipeUserId = new RecipeUserId(dbUser.id);
    const session = await Session.createNewSession(req, res, TENANT_ID, sessionRecipeUserId);
    await session.mergeIntoAccessTokenPayload({ role: dbUser.role });

    return {
      message: createdNewRecipeUser
        ? `Account created via ${providerLabel}`
        : `Signed in via ${providerLabel}`,
      user: { id: dbUser.id, email: dbUser.email, role: dbUser.role },
      createdNewUser: createdNewRecipeUser,
    };
  }
}
