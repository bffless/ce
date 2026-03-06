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

  /** Access token expires in 15 minutes */
  private readonly ACCESS_TOKEN_EXPIRY_SECONDS = 15 * 60; // 900 seconds

  /** Refresh token expires in 7 days */
  private readonly REFRESH_TOKEN_EXPIRY_SECONDS = 7 * 24 * 60 * 60; // 604800 seconds

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
   * Access tokens are short-lived (15 minutes) and contain full user info.
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
   * Refresh tokens are longer-lived (7 days) and contain minimal info.
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
   * @param res - Express response object
   * @param accessToken - The access token to set
   * @param refreshToken - The refresh token to set
   * @param secure - Whether to set Secure flag (should be true in production)
   */
  setAuthCookies(res: Response, accessToken: string, refreshToken: string, secure: boolean = true): void {
    // Access cookie - available site-wide
    res.cookie(CustomDomainAuthService.ACCESS_COOKIE_NAME, accessToken, {
      maxAge: this.ACCESS_TOKEN_EXPIRY_SECONDS * 1000,
      httpOnly: true,
      secure,
      sameSite: 'strict',
      path: '/',
    });

    // Refresh cookie - restricted to the refresh endpoint path
    res.cookie(CustomDomainAuthService.REFRESH_COOKIE_NAME, refreshToken, {
      maxAge: this.REFRESH_TOKEN_EXPIRY_SECONDS * 1000,
      httpOnly: true,
      secure,
      sameSite: 'strict',
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
      sameSite: 'strict',
      path: '/',
    });

    res.clearCookie(CustomDomainAuthService.REFRESH_COOKIE_NAME, {
      httpOnly: true,
      secure,
      sameSite: 'strict',
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
