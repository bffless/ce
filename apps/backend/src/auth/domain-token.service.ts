import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';

/**
 * Payload structure for domain relay tokens.
 * These short-lived tokens are used to transfer authentication from
 * the workspace domain (SuperTokens) to custom domains (bffless cookies).
 */
export interface DomainTokenPayload {
  /** User ID (from app database) */
  sub: string;
  /** User email */
  email: string;
  /** User role (admin, user, member) */
  role: string;
  /** Target custom domain this token is valid for */
  targetDomain: string;
  /** Original redirect path on the custom domain */
  redirectPath?: string;
  /** Issued at timestamp */
  iat: number;
  /** Expiration timestamp */
  exp: number;
}

@Injectable()
export class DomainTokenService {
  private readonly logger = new Logger(DomainTokenService.name);
  private readonly jwtSecret: string;

  /** Domain relay tokens expire in 5 minutes (300 seconds) */
  private readonly TOKEN_EXPIRY_SECONDS = 300;

  constructor(private readonly configService: ConfigService) {
    const secret = this.configService.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET environment variable is required for domain token service');
    }
    this.jwtSecret = secret;
  }

  /**
   * Create a short-lived JWT token for domain relay.
   * This token is used to transfer user authentication from the workspace domain
   * to a custom domain's callback endpoint.
   *
   * @param userId - User ID from the database
   * @param email - User email address
   * @param role - User role (admin, user, member)
   * @param targetDomain - The custom domain this token is intended for
   * @param redirectPath - Optional path to redirect to after auth
   * @returns Signed JWT token string
   */
  createDomainToken(
    userId: string,
    email: string,
    role: string,
    targetDomain: string,
    redirectPath?: string,
  ): string {
    const now = Math.floor(Date.now() / 1000);

    const payload: Omit<DomainTokenPayload, 'iat' | 'exp'> = {
      sub: userId,
      email,
      role,
      targetDomain,
      ...(redirectPath && { redirectPath }),
    };

    const token = jwt.sign(payload, this.jwtSecret, {
      expiresIn: this.TOKEN_EXPIRY_SECONDS,
      algorithm: 'HS256',
    });

    this.logger.debug(
      `Created domain token for user ${userId} targeting ${targetDomain} (expires in ${this.TOKEN_EXPIRY_SECONDS}s)`,
    );

    return token;
  }

  /**
   * Verify and decode a domain relay token.
   *
   * @param token - The JWT token string to verify
   * @returns The decoded payload if valid, null otherwise
   */
  verifyDomainToken(token: string): DomainTokenPayload | null {
    try {
      const decoded = jwt.verify(token, this.jwtSecret, {
        algorithms: ['HS256'],
      }) as DomainTokenPayload;

      this.logger.debug(`Verified domain token for user ${decoded.sub} targeting ${decoded.targetDomain}`);

      return decoded;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        this.logger.debug('Domain token expired');
      } else if (error instanceof jwt.JsonWebTokenError) {
        this.logger.debug(`Invalid domain token: ${error.message}`);
      } else {
        this.logger.error('Error verifying domain token', error);
      }
      return null;
    }
  }
}
