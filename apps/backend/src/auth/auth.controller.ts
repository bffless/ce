import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  Res,
  Query,
  HttpCode,
  HttpStatus,
  BadRequestException,
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
import { db } from '../db/client';
import { workspaceInvitations } from '../db/schema';
import { eq, and, isNull, gt } from 'drizzle-orm';
import EmailPassword from 'supertokens-node/recipe/emailpassword';
import EmailVerification from 'supertokens-node/recipe/emailverification';
import Session from 'supertokens-node/recipe/session';
import { SessionContainer } from 'supertokens-node/recipe/session';
import { RecipeUserId } from 'supertokens-node';
import { getUser, listUsersByAccountInfo } from 'supertokens-node';

interface SignUpDto {
  email: string;
  password: string;
}

interface SignInDto {
  email: string;
  password: string;
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

@ApiTags('Authentication')
@Controller('api/auth')
export class AuthController {
  private readonly logger = new (require('@nestjs/common').Logger)(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly setupService: SetupService,
    private readonly featureFlagsService: FeatureFlagsService,
    private readonly onboardingExecutorService: OnboardingExecutorService,
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

  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new user' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        email: { type: 'string', format: 'email', example: 'user@example.com' },
        password: { type: 'string', minLength: 8, example: 'SecurePassword123!' },
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
    const { email, password } = body;

    if (!email || !password) {
      throw new BadRequestException('Email and password are required');
    }

    // Validate password strength
    if (password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters long');
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

        await Session.createNewSession(req, res, tenantId, signInResponse.recipeUserId);

        let emailVerificationRequired = false;
        try {
          emailVerificationRequired = await this.isEmailVerificationRequired();
          if (emailVerificationRequired) {
            const origin = req.headers.origin || req.headers.referer;
            await EmailVerification.sendEmailVerificationEmail(
              tenantId,
              userId,
              signInResponse.recipeUserId,
              email,
              { requestOrigin: origin },
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

      // Create session so user is immediately logged in
      await Session.createNewSession(req, res, tenantId, signUpResponse.recipeUserId);

      // Check if email verification is required and send verification email
      let emailVerificationRequired = false;
      try {
        emailVerificationRequired = await this.isEmailVerificationRequired();
        if (emailVerificationRequired) {
          const origin = req.headers.origin || req.headers.referer;
          await EmailVerification.sendEmailVerificationEmail(
            tenantId,
            userId,
            signUpResponse.recipeUserId,
            email,
            { requestOrigin: origin },
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

    try {
      const tenantId = this.getTenantId();

      const signInResponse = await EmailPassword.signIn(tenantId, email, password);

      if (signInResponse.status === 'WRONG_CREDENTIALS_ERROR') {
        throw new UnauthorizedException('Invalid email or password');
      }

      if (signInResponse.status !== 'OK') {
        throw new UnauthorizedException('Failed to sign in');
      }

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
      // This allows Control Plane to validate admin access without database lookup
      await session.mergeIntoAccessTokenPayload({
        role: user.role,
      });

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
        const origin = req.headers.origin || req.headers.referer;

        // Use SuperTokens to send password reset email
        // Pass origin in userContext so email delivery can construct the correct URL
        await EmailPassword.sendResetPasswordEmail(tenantId, user.id, email, {
          requestOrigin: origin,
        });
        console.log('[Password Reset] Reset email sent for:', email);
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
  async sendVerificationEmail(@Req() req: Request & { session?: SessionContainer }) {
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
    const origin = req.headers.origin || req.headers.referer;

    await EmailVerification.sendEmailVerificationEmail(tenantId, userId, recipeUserId, email, {
      requestOrigin: origin,
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
      'Check if user registration is available. Returns whether public signups are allowed. Public endpoint.',
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
      },
    },
  })
  async getRegistrationStatus(): Promise<{
    registrationEnabled: boolean;
    allowPublicSignups: boolean;
  }> {
    return this.setupService.getRegistrationSettings();
  }
}
