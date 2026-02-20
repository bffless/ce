import { Injectable, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { verifySession } from 'supertokens-node/recipe/session/framework/express';
import { SessionContainer } from 'supertokens-node/recipe/session';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { users } from '../db/schema';
import { EmailService } from '../email/email.service';
import { ProxyRule } from '../db/schema/proxy-rules.schema';

interface AuthenticatedUser {
  id: string;
  email?: string;
}

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

/**
 * Email Form Handler Service
 *
 * Handles POST form submissions for email_form_handler proxy rules.
 * Captures form data and sends it via email to the configured destination.
 */
@Injectable()
export class EmailFormHandlerService {
  private readonly logger = new Logger(EmailFormHandlerService.name);

  // In-memory rate limiting: IP -> { count, resetTime }
  private readonly rateLimitCache = new Map<string, RateLimitEntry>();
  private readonly RATE_LIMIT_MAX = 10; // max submissions per period
  private readonly RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

  constructor(private readonly emailService: EmailService) {
    // Clean up expired rate limit entries every 10 minutes
    setInterval(() => this.cleanupRateLimitCache(), 10 * 60 * 1000);
  }

  /**
   * Handle a form submission request.
   *
   * @param req - Express request
   * @param res - Express response
   * @param rule - The matched proxy rule with email handler config
   */
  async handleSubmission(req: Request, res: Response, rule: ProxyRule): Promise<void> {
    const config = rule.emailHandlerConfig;

    // 1. Check method (POST only)
    if (req.method !== 'POST') {
      this.logger.debug(`Method not allowed: ${req.method} for path ${rule.pathPattern}`);
      res.status(405).json({
        success: false,
        error: 'Method Not Allowed',
        message: 'Only POST requests are accepted for form submissions',
      });
      return;
    }

    // 2. Handle CORS headers
    if (config?.corsOrigin) {
      res.setHeader('Access-Control-Allow-Origin', config.corsOrigin);
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }

    // 3. Check authentication if required
    let authenticatedUser: AuthenticatedUser | null = null;
    if (config?.requireAuth) {
      authenticatedUser = await this.validateSession(req, res);
      if (!authenticatedUser) {
        // Response already sent by validateSession
        return;
      }
      this.logger.debug(`Authenticated form submission by user: ${authenticatedUser.email || authenticatedUser.id}`);
    }

    // 5. Check rate limit
    const clientIp = this.getClientIp(req);
    if (this.isRateLimited(clientIp)) {
      this.logger.warn(`Rate limit exceeded for IP: ${clientIp}`);
      res.status(429).json({
        success: false,
        error: 'Too Many Requests',
        message: 'Rate limit exceeded. Please try again later.',
      });
      return;
    }

    // 6. Parse form data
    let formData: Record<string, unknown>;
    try {
      formData = await this.parseFormData(req);
    } catch (error) {
      this.logger.error(`Failed to parse form data: ${error}`);
      res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'Failed to parse form data',
      });
      return;
    }

    // 7. Check honeypot field (spam protection)
    if (config?.honeypotField && formData[config.honeypotField]) {
      // Honeypot filled - silently return success to not reveal spam detection
      this.logger.debug(`Honeypot triggered for path ${rule.pathPattern}`);
      this.sendSuccessResponse(res, config?.successRedirect);
      return;
    }

    // 8. Check if email service is configured
    if (!this.emailService.isConfigured()) {
      this.logger.error('Email service not configured');
      res.status(503).json({
        success: false,
        error: 'Service Unavailable',
        message: 'Email service is not configured',
      });
      return;
    }

    // 9. Check destination email
    if (!config?.destinationEmail) {
      this.logger.error('No destination email configured for rule');
      res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'Email form handler is not properly configured',
      });
      return;
    }

    // 10. Build and send email
    try {
      const { html, text } = this.buildEmailContent(formData, req, authenticatedUser);
      const subject = config.subject || 'Form Submission';
      const replyTo = config.replyToField ? String(formData[config.replyToField]) : undefined;

      const result = await this.emailService.sendEmail({
        to: config.destinationEmail,
        subject,
        html,
        text,
        replyTo: replyTo && this.isValidEmail(replyTo) ? replyTo : undefined,
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to send email');
      }

      this.logger.log(`Form submission sent to ${config.destinationEmail}`);

      // Increment rate limit counter
      this.incrementRateLimit(clientIp);

      // 11. Return success response
      this.sendSuccessResponse(res, config.successRedirect);
    } catch (error) {
      this.logger.error(`Failed to send form submission email: ${error}`);
      res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'Failed to send email. Please try again later.',
      });
    }
  }

  /**
   * Parse form data from the request body.
   * Supports JSON, URL-encoded, and multipart form data (without files).
   */
  private async parseFormData(req: Request): Promise<Record<string, unknown>> {
    // Express body-parser should have already parsed the body
    // for JSON and URL-encoded content types
    if (req.body && typeof req.body === 'object') {
      return req.body as Record<string, unknown>;
    }

    // If body is not parsed, try to parse it based on content type
    const contentType = req.headers['content-type'] || '';

    if (contentType.includes('application/json')) {
      return this.parseJsonBody(req);
    }

    if (contentType.includes('application/x-www-form-urlencoded')) {
      // Body should already be parsed by express.urlencoded()
      return req.body || {};
    }

    if (contentType.includes('multipart/form-data')) {
      // For multipart, we'd need a library like multer
      // For now, we'll return the body as-is (may be pre-parsed)
      return req.body || {};
    }

    return req.body || {};
  }

  /**
   * Parse JSON body from request
   */
  private parseJsonBody(req: Request): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      if (req.body) {
        resolve(req.body);
        return;
      }

      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error('Invalid JSON'));
        }
      });
      req.on('error', reject);
    });
  }

  /**
   * Build email content from form data
   */
  private buildEmailContent(
    formData: Record<string, unknown>,
    req: Request,
    authenticatedUser: AuthenticatedUser | null,
  ): { html: string; text: string } {
    const fields = Object.entries(formData);
    const timestamp = new Date().toISOString();
    const origin = req.headers.origin || req.headers.referer || 'Unknown';
    const userAgent = req.headers['user-agent'] || 'Unknown';

    // Build HTML table
    const tableRows = fields
      .map(
        ([key, value]) =>
          `<tr>
            <td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold; background: #f5f5f5; vertical-align: top;">${this.escapeHtml(key)}</td>
            <td style="padding: 8px 12px; border: 1px solid #ddd; white-space: pre-wrap;">${this.escapeHtml(this.formatValue(value))}</td>
          </tr>`,
      )
      .join('\n');

    // Build authenticated user section if available
    let userInfoHtml = '';
    let userInfoText = '';
    if (authenticatedUser) {
      userInfoHtml = `
        <div style="margin-top: 20px; padding: 15px; background: #e8f4fd; border-radius: 6px; border-left: 4px solid #0066cc;">
          <p style="margin: 0 0 8px 0; font-weight: bold; color: #0066cc;">Authenticated User</p>
          <ul style="list-style: none; padding: 0; margin: 0; color: #333;">
            ${authenticatedUser.email ? `<li>Email: ${this.escapeHtml(authenticatedUser.email)}</li>` : ''}
            <li>User ID: ${this.escapeHtml(authenticatedUser.id)}</li>
          </ul>
        </div>
      `;
      userInfoText = `\n\nAuthenticated User:\n- Email: ${authenticatedUser.email || 'N/A'}\n- User ID: ${authenticatedUser.id}`;
    }

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333; border-bottom: 2px solid #0066cc; padding-bottom: 10px;">Form Submission</h2>

        ${userInfoHtml}

        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          ${tableRows}
        </table>

        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 12px;">
          <p><strong>Submission Details:</strong></p>
          <ul style="list-style: none; padding: 0; margin: 0;">
            <li>Submitted at: ${timestamp}</li>
            <li>Origin: ${this.escapeHtml(String(origin))}</li>
            <li>User Agent: ${this.escapeHtml(String(userAgent))}</li>
          </ul>
        </div>
      </div>
    `;

    // Build plain text version
    const textLines = fields.map(([key, value]) => `${key}: ${this.formatValue(value)}`);
    const text = `Form Submission${userInfoText}\n\n${textLines.join('\n')}\n\n---\nSubmitted at: ${timestamp}\nOrigin: ${origin}`;

    return { html, text };
  }

  /**
   * Format a value for display
   */
  private formatValue(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }
    if (typeof value === 'object') {
      return JSON.stringify(value, null, 2);
    }
    return String(value);
  }

  /**
   * Escape HTML special characters
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Send success response (JSON or redirect)
   */
  private sendSuccessResponse(res: Response, redirectUrl?: string): void {
    if (redirectUrl) {
      // 303 See Other - redirect after POST
      res.redirect(303, redirectUrl);
    } else {
      res.status(200).json({
        success: true,
        message: 'Form submitted successfully',
      });
    }
  }

  /**
   * Get client IP address from request
   */
  private getClientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      const ips = String(forwarded).split(',');
      return ips[0].trim();
    }
    return req.ip || req.socket.remoteAddress || 'unknown';
  }

  /**
   * Check if IP is rate limited
   */
  private isRateLimited(ip: string): boolean {
    const entry = this.rateLimitCache.get(ip);
    if (!entry) {
      return false;
    }

    // Check if the window has expired
    if (Date.now() > entry.resetTime) {
      this.rateLimitCache.delete(ip);
      return false;
    }

    return entry.count >= this.RATE_LIMIT_MAX;
  }

  /**
   * Increment rate limit counter for IP
   */
  private incrementRateLimit(ip: string): void {
    const entry = this.rateLimitCache.get(ip);
    const now = Date.now();

    if (!entry || now > entry.resetTime) {
      // Start new window
      this.rateLimitCache.set(ip, {
        count: 1,
        resetTime: now + this.RATE_LIMIT_WINDOW_MS,
      });
    } else {
      // Increment existing counter
      entry.count++;
    }
  }

  /**
   * Clean up expired rate limit entries
   */
  private cleanupRateLimitCache(): void {
    const now = Date.now();
    for (const [ip, entry] of this.rateLimitCache.entries()) {
      if (now > entry.resetTime) {
        this.rateLimitCache.delete(ip);
      }
    }
  }

  /**
   * Simple email validation
   */
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Validate the session and return authenticated user details.
   * Returns null and sends error response if not authenticated.
   */
  private async validateSession(
    req: Request,
    res: Response,
  ): Promise<AuthenticatedUser | null> {
    return new Promise((resolve) => {
      verifySession()(req, res, async (err) => {
        if (err) {
          this.logger.debug(`Session validation failed: ${err.message}`);
          res.status(401).json({
            success: false,
            error: 'Unauthorized',
            message: 'Authentication required to submit this form',
          });
          resolve(null);
          return;
        }

        // Session is now available on request.session
        const session = (req as Request & { session?: SessionContainer }).session;

        if (!session) {
          res.status(401).json({
            success: false,
            error: 'Unauthorized',
            message: 'No active session',
          });
          resolve(null);
          return;
        }

        const userId = session.getUserId();

        // Fetch user details from database
        try {
          const [user] = await db
            .select({ id: users.id, email: users.email })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);

          if (!user) {
            res.status(401).json({
              success: false,
              error: 'Unauthorized',
              message: 'User not found',
            });
            resolve(null);
            return;
          }

          resolve({
            id: user.id,
            email: user.email || undefined,
          });
        } catch (dbError) {
          this.logger.error(`Failed to fetch user details: ${dbError}`);
          res.status(500).json({
            success: false,
            error: 'Internal Server Error',
            message: 'Failed to validate user',
          });
          resolve(null);
        }
      });
    });
  }
}
