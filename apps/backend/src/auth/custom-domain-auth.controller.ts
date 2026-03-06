import {
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  Logger,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { DomainTokenService } from './domain-token.service';
import { CustomDomainAuthService } from './custom-domain-auth.service';
import { AuthService } from './auth.service';

/**
 * Controller for custom domain authentication endpoints.
 * These endpoints are namespaced under /_bffless/auth/ to avoid
 * collision with user application routes on custom domains.
 */
@ApiTags('Custom Domain Authentication')
@Controller('_bffless/auth')
export class CustomDomainAuthController {
  private readonly logger = new Logger(CustomDomainAuthController.name);

  constructor(
    private readonly domainTokenService: DomainTokenService,
    private readonly customDomainAuthService: CustomDomainAuthService,
    private readonly authService: AuthService,
  ) {}

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
    const host = req.headers['x-forwarded-host'] as string || req.headers.host;
    const requestDomain = host?.split(':')[0]; // Remove port if present

    if (requestDomain !== payload.targetDomain) {
      this.logger.warn(
        `Domain mismatch: token for ${payload.targetDomain}, request from ${requestDomain}`,
      );
      throw new UnauthorizedException('Token not valid for this domain');
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

    // Determine if we should use secure cookies
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const secure = protocol === 'https';

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
      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      const secure = protocol === 'https';
      this.customDomainAuthService.clearAuthCookies(res, secure);
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Verify the domain matches
    const host = req.headers['x-forwarded-host'] as string || req.headers.host;
    const requestDomain = host?.split(':')[0];

    if (requestDomain !== payload.domain) {
      this.logger.warn(
        `Domain mismatch on refresh: token for ${payload.domain}, request from ${requestDomain}`,
      );
      throw new UnauthorizedException('Refresh token not valid for this domain');
    }

    // Verify user still exists and is authorized
    const user = await this.authService.getUserById(payload.sub);
    if (!user) {
      this.logger.warn(`User ${payload.sub} not found during refresh`);
      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      const secure = protocol === 'https';
      this.customDomainAuthService.clearAuthCookies(res, secure);
      throw new UnauthorizedException('User not found');
    }

    // Check if user is disabled
    if (user.disabled) {
      this.logger.warn(`User ${payload.sub} is disabled during refresh`);
      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      const secure = protocol === 'https';
      this.customDomainAuthService.clearAuthCookies(res, secure);
      throw new UnauthorizedException('User account is disabled');
    }

    // Create new access token with current user data
    const accessToken = this.customDomainAuthService.createAccessToken(
      user.id,
      user.email,
      user.role,
      payload.domain,
    );

    // Set the new access cookie
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const secure = protocol === 'https';

    res.cookie(CustomDomainAuthService.ACCESS_COOKIE_NAME, accessToken, {
      maxAge: this.customDomainAuthService.getAccessTokenExpiry() * 1000,
      httpOnly: true,
      secure,
      sameSite: 'strict',
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
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const secure = protocol === 'https';

    this.customDomainAuthService.clearAuthCookies(res, secure);

    this.logger.debug('Cleared auth cookies for custom domain logout');

    res.status(200).json({ message: 'Logged out successfully' });
  }
}
