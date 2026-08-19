import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import * as jwt from 'jsonwebtoken';

/**
 * Payload structure for custom domain access tokens.
 */
export interface AccessTokenPayload {
  /** User ID */
  sub: string;
  /** User email */
  email: string;
  /** User role */
  role: string;
  /** Custom domain this token is valid for */
  domain: string;
  /** Token type identifier */
  type: 'access';
  /** Issued at timestamp */
  iat: number;
  /** Expiration timestamp */
  exp: number;
}

/**
 * Payload structure for custom domain refresh tokens.
 */
export interface RefreshTokenPayload {
  /** User ID */
  sub: string;
  /** Custom domain this token is valid for */
  domain: string;
  /** Token type identifier */
  type: 'refresh';
  /** Issued at timestamp */
  iat: number;
  /** Expiration timestamp */
  exp: number;
}

/**
 * Service for managing custom domain authentication cookies.
 * Custom domains use their own JWT-based cookies (bffless_access, bffless_refresh)
 * instead of SuperTokens session cookies, since cookies are domain-scoped.
 */
@Injectable()
export class CustomDomainAuthService {
  private readonly logger = new Logger(CustomDomainAuthService.name);
  private readonly jwtSecret: string;

  /** Access token JWT expires in 1 hour (matches SuperTokens default) */
  private readonly ACCESS_TOKEN_EXPIRY_SECONDS = 60 * 60; // 3600 seconds

  /** Refresh token JWT expires in 100 days (matches SuperTokens default) */
  private readonly REFRESH_TOKEN_EXPIRY_SECONDS = 100 * 24 * 60 * 60; // 8640000 seconds

  /**
   * Access token COOKIE expires in 400 days (~13 months, matches SuperTokens).
   * This is intentionally much longer than the JWT expiry to ensure the cookie
   * persists for the refresh flow to work.
   */
  private readonly ACCESS_COOKIE_EXPIRY_SECONDS = 400 * 24 * 60 * 60; // 34560000 seconds

  /** Cookie names */
  static readonly ACCESS_COOKIE_NAME = 'bffless_access';
  static readonly REFRESH_COOKIE_NAME = 'bffless_refresh';

  constructor(private readonly configService: ConfigService) {
    const secret = this.configService.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET environment variable is required for custom domain auth service');
    }
    this.jwtSecret = secret;
  }

  /**
   * Create an access token for a custom domain.
   * Access tokens are short-lived (1 hour) and contain full user info.
   *
   * @param userId - User ID from the database
   * @param email - User email address
   * @param role - User role (admin, user, member)
   * @param domain - The custom domain this token is valid for
   * @returns Signed JWT access token string
   */
  createAccessToken(userId: string, email: string, role: string, domain: string): string {
    const payload: Omit<AccessTokenPayload, 'iat' | 'exp'> = {
      sub: userId,
      email,
      role,
      domain,
      type: 'access',
    };

    const token = jwt.sign(payload, this.jwtSecret, {
      expiresIn: this.ACCESS_TOKEN_EXPIRY_SECONDS,
      algorithm: 'HS256',
    });

    this.logger.debug(
      `Created access token for user ${userId} on domain ${domain} (expires in ${this.ACCESS_TOKEN_EXPIRY_SECONDS}s)`,
    );

    return token;
  }

  /**
   * Create a refresh token for a custom domain.
   * Refresh tokens are longer-lived (~100 days) and contain minimal info.
   *
   * @param userId - User ID from the database
   * @param domain - The custom domain this token is valid for
   * @returns Signed JWT refresh token string
   */
  createRefreshToken(userId: string, domain: string): string {
    const payload: Omit<RefreshTokenPayload, 'iat' | 'exp'> = {
      sub: userId,
      domain,
      type: 'refresh',
    };

    const token = jwt.sign(payload, this.jwtSecret, {
      expiresIn: this.REFRESH_TOKEN_EXPIRY_SECONDS,
      algorithm: 'HS256',
    });

    this.logger.debug(
      `Created refresh token for user ${userId} on domain ${domain} (expires in ${this.REFRESH_TOKEN_EXPIRY_SECONDS}s)`,
    );

    return token;
  }

  /**
   * Validate and decode an access token.
   *
   * @param token - The JWT token string to verify
   * @returns The decoded payload if valid, null otherwise
   */
  validateAccessToken(token: string): AccessTokenPayload | null {
    try {
      const decoded = jwt.verify(token, this.jwtSecret, {
        algorithms: ['HS256'],
      }) as AccessTokenPayload;

      // Verify this is an access token
      if (decoded.type !== 'access') {
        this.logger.debug('Token is not an access token');
        return null;
      }

      return decoded;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        this.logger.debug('Access token expired');
      } else if (error instanceof jwt.JsonWebTokenError) {
        this.logger.debug(`Invalid access token: ${error.message}`);
      } else {
        this.logger.error('Error validating access token', error);
      }
      return null;
    }
  }

  /**
   * Check if an access token is expired (as opposed to invalid/malformed).
   * Used by the session endpoint to tell clients to try refreshing.
   */
  isAccessTokenExpired(token: string): boolean {
    try {
      jwt.verify(token, this.jwtSecret, { algorithms: ['HS256'] });
      return false;
    } catch (error) {
      return error instanceof jwt.TokenExpiredError;
    }
  }

  /**
   * Validate and decode a refresh token.
   *
   * @param token - The JWT token string to verify
   * @returns The decoded payload if valid, null otherwise
   */
  validateRefreshToken(token: string): RefreshTokenPayload | null {
    try {
      const decoded = jwt.verify(token, this.jwtSecret, {
        algorithms: ['HS256'],
      }) as RefreshTokenPayload;

      // Verify this is a refresh token
      if (decoded.type !== 'refresh') {
        this.logger.debug('Token is not a refresh token');
        return null;
      }

      return decoded;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        this.logger.debug('Refresh token expired');
      } else if (error instanceof jwt.JsonWebTokenError) {
        this.logger.debug(`Invalid refresh token: ${error.message}`);
      } else {
        this.logger.error('Error validating refresh token', error);
      }
      return null;
    }
  }

  /**
   * Set both access and refresh cookies on the response.
   * Access cookie is available site-wide, refresh cookie is restricted to the refresh endpoint.
   *
   * Cookie expiry pattern matches SuperTokens:
   * - Access cookie: ~13 months (much longer than JWT to enable refresh detection)
   * - Refresh cookie: ~100 days (matches refresh token JWT validity)
   *
   * This ensures the access cookie persists even after the JWT expires, allowing the client
   * to detect the expired token and trigger a refresh.
   *
   * @param res - Express response object
   * @param accessToken - The access token to set
   * @param refreshToken - The refresh token to set
   * @param secure - Whether to set Secure flag (should be true in production)
   */
  setAuthCookies(
    res: Response,
    accessToken: string,
    refreshToken: string,
    secure: boolean = true,
  ): void {
    // Access cookie - available site-wide
    // Uses long cookie expiry (~13 months) so expired JWTs can trigger refresh flow
    res.cookie(CustomDomainAuthService.ACCESS_COOKIE_NAME, accessToken, {
      maxAge: this.ACCESS_COOKIE_EXPIRY_SECONDS * 1000,
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
    });

    // Refresh cookie - restricted to the refresh endpoint path
    // Cookie expiry matches refresh token JWT validity (~100 days)
    res.cookie(CustomDomainAuthService.REFRESH_COOKIE_NAME, refreshToken, {
      maxAge: this.REFRESH_TOKEN_EXPIRY_SECONDS * 1000,
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/_bffless/auth', // Only sent to auth endpoints
    });

    this.logger.debug('Set auth cookies for custom domain');
  }

  /**
   * Clear both authentication cookies.
   *
   * @param res - Express response object
   * @param secure - Whether to set Secure flag (should match setAuthCookies)
   */
  clearAuthCookies(res: Response, secure: boolean = true): void {
    res.clearCookie(CustomDomainAuthService.ACCESS_COOKIE_NAME, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
    });

    res.clearCookie(CustomDomainAuthService.REFRESH_COOKIE_NAME, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/_bffless/auth',
    });

    this.logger.debug('Cleared auth cookies for custom domain');
  }

  /**
   * Get the access token expiry time in seconds.
   */
  getAccessTokenExpiry(): number {
    return this.ACCESS_TOKEN_EXPIRY_SECONDS;
  }

  /**
   * Get the refresh token expiry time in seconds.
   */
  getRefreshTokenExpiry(): number {
    return this.REFRESH_TOKEN_EXPIRY_SECONDS;
  }
}
