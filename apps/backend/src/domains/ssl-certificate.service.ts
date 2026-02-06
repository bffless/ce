import { Injectable, Logger } from '@nestjs/common';
import * as acme from 'acme-client';
import * as forge from 'node-forge';
import { readFile, writeFile, mkdir, access, unlink } from 'fs/promises';
import { promises as dns } from 'dns';
import { join } from 'path';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/client';
import { sslChallenges, SslChallenge } from '../db/schema';

export interface DnsChallenge {
  domain: string;
  recordName: string;
  recordValue: string;
  recordValues: string[]; // Multiple TXT record values (for wildcard + base domain)
  token: string;
  expiresAt: Date;
}

export interface CertificateInfo {
  exists: boolean;
  isSelfSigned?: boolean;
  issuer?: string;
  expiresAt?: Date;
  daysUntilExpiry?: number;
}

// Challenge type from rfc8555 - using explicit union for type safety
type AcmeChallenge = {
  type: 'http-01' | 'dns-01';
  url: string;
  status: 'pending' | 'processing' | 'valid' | 'invalid';
  token: string;
  validated?: string;
  error?: object;
};

@Injectable()
export class SslCertificateService {
  private readonly logger = new Logger(SslCertificateService.name);
  private acmeClient: acme.Client | null = null;
  private accountKey: Buffer | null = null;
  private initialized = false;
  private readonly mockMode: boolean;
  // Track mock certificates (domain -> expiry date)
  private mockCertificates: Map<string, Date> = new Map();

  constructor() {
    this.mockMode = process.env.MOCK_SSL === 'true';
    if (this.mockMode) {
      this.logger.warn('🔧 SSL Mock Mode ENABLED - No real certificates will be issued');
    }
    if (this.isExternalSsl()) {
      this.logger.log('SSL managed externally (SSL_MANAGED_EXTERNALLY=true) - ACME disabled');
    }
  }

  /**
   * Check if SSL is managed externally (e.g., by Traefik, Cloudflare, load balancer)
   */
  private isExternalSsl(): boolean {
    return process.env.SSL_MANAGED_EXTERNALLY === 'true';
  }

  /**
   * Check if mock mode is enabled
   */
  isMockMode(): boolean {
    return this.mockMode;
  }

  /**
   * Initialize ACME client (call on module init)
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Skip ACME initialization if SSL is handled externally or in mock mode
    if (this.mockMode || this.isExternalSsl()) {
      this.initialized = true;
      const reason = this.mockMode ? 'mock mode' : 'external SSL (Traefik/LB)';
      this.logger.log(`ACME client initialization skipped (${reason})`);
      return;
    }

    try {
      // Use Let's Encrypt staging for development, production for prod
      const directoryUrl =
        process.env.NODE_ENV === 'production'
          ? acme.directory.letsencrypt.production
          : acme.directory.letsencrypt.staging;

      // Load or generate account key
      this.accountKey = await this.getOrCreateAccountKey();

      this.acmeClient = new acme.Client({
        directoryUrl,
        accountKey: this.accountKey,
      });

      // Register account if needed
      const email = process.env.CERTBOT_EMAIL;
      if (!email) {
        throw new Error('CERTBOT_EMAIL environment variable is not set');
      }
      await this.acmeClient.createAccount({
        termsOfServiceAgreed: true,
        contact: [`mailto:${email}`],
      });

      this.initialized = true;
      this.logger.log(
        `ACME client initialized (${process.env.NODE_ENV === 'production' ? 'production' : 'staging'})`,
      );
    } catch (error) {
      this.logger.error(`Failed to initialize ACME client: ${error}`);
      // Don't throw - allow the service to start even if ACME init fails
      // SSL operations will fail gracefully with a clear error message
    }
  }

  /**
   * Start wildcard certificate request - returns DNS challenge for user
   */
  async startWildcardCertificateRequest(baseDomain: string): Promise<DnsChallenge> {
    // Mock mode: return fake challenge data
    if (this.mockMode) {
      return this.startMockWildcardCertificateRequest(baseDomain);
    }

    if (!this.acmeClient) {
      throw new Error('ACME client not initialized. Check CERTBOT_EMAIL environment variable.');
    }

    // Check for existing pending challenge
    const existing = await this.getPendingChallengeFromDb(baseDomain);
    if (existing) {
      // Return existing challenge if not expired
      if (new Date(existing.expiresAt) > new Date()) {
        this.logger.log(`Returning existing pending challenge for *.${baseDomain}`);
        // Parse record values - may be JSON array or single value (backward compat)
        let recordValues: string[];
        try {
          recordValues = JSON.parse(existing.recordValue);
          if (!Array.isArray(recordValues)) {
            recordValues = [existing.recordValue];
          }
        } catch {
          recordValues = [existing.recordValue];
        }
        return {
          domain: existing.baseDomain,
          recordName: existing.recordName,
          recordValue: recordValues[0], // Primary value for backward compat
          recordValues,
          token: existing.token,
          expiresAt: new Date(existing.expiresAt),
        };
      }
      // Delete expired challenge
      await this.deleteChallengeFromDb(baseDomain);
    }

    // Create order for wildcard + base domain
    const order = await this.acmeClient.createOrder({
      identifiers: [
        { type: 'dns', value: `*.${baseDomain}` },
        { type: 'dns', value: baseDomain },
      ],
    });

    // Get authorizations
    const authorizations = await this.acmeClient.getAuthorizations(order);

    // Collect DNS-01 challenges and key authorizations for ALL authorizations
    const recordValues: string[] = [];
    let primaryToken = '';

    for (const authz of authorizations) {
      const challenge = authz.challenges.find((c) => c.type === 'dns-01');
      if (challenge) {
        const keyAuth = await this.acmeClient.getChallengeKeyAuthorization(challenge);
        recordValues.push(keyAuth);
        if (!primaryToken) {
          primaryToken = challenge.token;
        }
        this.logger.log(
          `Got key authorization for ${authz.identifier.value}: ${keyAuth.substring(0, 20)}...`,
        );
      }
    }

    if (recordValues.length === 0) {
      throw new Error('DNS-01 challenge not available');
    }

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    const recordName = `_acme-challenge.${baseDomain}`;

    // Store in database - store ALL authorizations and record values
    await this.saveChallengeToDb({
      baseDomain,
      challengeType: 'dns-01',
      recordName,
      recordValue: JSON.stringify(recordValues), // Store as JSON array
      token: primaryToken,
      orderData: JSON.stringify(order),
      authzData: JSON.stringify(authorizations), // Store ALL authorizations
      keyAuthorization: recordValues[0], // Primary for backward compat
      status: 'pending',
      expiresAt,
    });

    this.logger.log(
      `Started wildcard certificate request for *.${baseDomain} (${recordValues.length} TXT records needed)`,
    );

    return {
      domain: baseDomain,
      recordName,
      recordValue: recordValues[0], // Primary value for backward compat
      recordValues,
      token: primaryToken,
      expiresAt,
    };
  }

  /**
   * Complete wildcard certificate request after user adds DNS record
   */
  async completeWildcardCertificateRequest(baseDomain: string): Promise<{
    success: boolean;
    error?: string;
    expiresAt?: Date;
  }> {
    // Mock mode: simulate successful certificate issuance
    if (this.mockMode) {
      return this.completeMockWildcardCertificateRequest(baseDomain);
    }

    const pending = await this.getPendingChallengeFromDb(baseDomain);
    if (!pending) {
      return { success: false, error: 'No pending certificate request found' };
    }

    if (!this.acmeClient) {
      return { success: false, error: 'ACME client not initialized' };
    }

    try {
      // Parse stored order data - we need the order URL to refresh it
      const storedOrder = JSON.parse(pending.orderData) as acme.Order;

      // Re-fetch the current order state from ACME server
      const order = await this.acmeClient.getOrder(storedOrder);

      // Get fresh authorizations
      const authorizations = await this.acmeClient.getAuthorizations(order);

      this.logger.log(`Processing ${authorizations.length} authorizations for *.${baseDomain}`);

      // Complete ALL DNS-01 challenges (both *.domain and domain)
      for (const authz of authorizations) {
        const challenge = authz.challenges.find((c) => c.type === 'dns-01') as AcmeChallenge;

        if (!challenge) {
          this.logger.warn(`No DNS-01 challenge for ${authz.identifier.value}`);
          continue;
        }

        // Skip if already valid
        if (challenge.status === 'valid') {
          this.logger.log(`Challenge already valid for ${authz.identifier.value}`);
          continue;
        }

        this.logger.log(
          `Completing challenge for ${authz.identifier.value} (status: ${challenge.status})`,
        );

        // Verify the challenge (checks DNS record)
        await this.acmeClient.verifyChallenge(authz, challenge);

        // Complete the challenge - tell ACME server we're ready
        await this.acmeClient.completeChallenge(challenge);

        // Wait for validation
        await this.acmeClient.waitForValidStatus(challenge);

        this.logger.log(`Challenge validated for ${authz.identifier.value}`);
      }

      // Generate CSR and finalize order
      const [key, csr] = await acme.crypto.createCsr({
        commonName: `*.${baseDomain}`,
        altNames: [baseDomain],
      });

      // Re-fetch order to get current status before finalizing
      const refreshedOrder = await this.acmeClient.getOrder(order);
      this.logger.log(`Order status before finalize: ${refreshedOrder.status}`);

      // Finalize the order
      const finalizedOrder = await this.acmeClient.finalizeOrder(refreshedOrder, csr);
      this.logger.log(`Order status after finalize: ${finalizedOrder.status}`);

      // Wait for the order to become valid (certificate ready)
      // The order transitions: ready -> processing -> valid
      let validOrder = finalizedOrder;
      let attempts = 0;
      const maxAttempts = 30; // Wait up to 30 seconds

      while (validOrder.status === 'processing' && attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        validOrder = await this.acmeClient.getOrder(order);
        this.logger.log(`Waiting for certificate... Order status: ${validOrder.status}`);
        attempts++;
      }

      if (validOrder.status !== 'valid') {
        throw new Error(`Order did not become valid. Final status: ${validOrder.status}`);
      }

      const certificate = await this.acmeClient.getCertificate(validOrder);

      // Save certificate and key
      await this.saveWildcardCertificate(baseDomain, certificate, key);

      // Update challenge status and cleanup
      await this.updateChallengeStatus(baseDomain, 'verified');

      // Get expiry (Let's Encrypt certs are valid for 90 days)
      const expiresAt = this.parseCertificateExpiry(certificate);

      this.logger.log(`Wildcard certificate issued for *.${baseDomain}`);
      return { success: true, expiresAt };
    } catch (error) {
      this.logger.error(`Failed to complete certificate request: ${error}`);
      // Don't mark as failed - allow user to retry after fixing DNS
      // The challenge remains "pending" so they can try verification again
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Renew existing wildcard certificate
   * Uses the same DNS-01 challenge flow but may use cached challenge if within validity period
   * Note: Full auto-renewal for wildcard certificates requires DNS provider API integration
   */
  async renewWildcardCertificate(): Promise<{
    success: boolean;
    error?: string;
    expiresAt?: Date;
  }> {
    const baseDomain = process.env.PRIMARY_DOMAIN;
    if (!baseDomain) {
      return { success: false, error: 'PRIMARY_DOMAIN not configured' };
    }

    // Check if we have a pending challenge that's still valid
    const pending = await this.getPendingChallenge(baseDomain);
    if (pending) {
      // Try to complete the existing challenge
      return this.completeWildcardCertificateRequest(baseDomain);
    }

    // For auto-renewal to work seamlessly, this would need DNS API integration
    // (Cloudflare, Route53, etc.) to automatically create the DNS challenge records.
    // For now, return error indicating manual renewal is needed
    return {
      success: false,
      error:
        'Automatic wildcard renewal requires DNS API integration. Please renew manually via the DNS challenge flow.',
    };
  }

  /**
   * Request certificate for custom domain via HTTP-01 (automatic)
   * Supports multiple domains (SAN certificate) when alternate domain is provided
   */
  async requestCustomDomainCertificate(
    domain: string,
    alternateDomain?: string,
  ): Promise<{
    success: boolean;
    error?: string;
    expiresAt?: Date;
    domains?: string[];
  }> {
    if (!this.acmeClient) {
      return { success: false, error: 'ACME client not initialized' };
    }

    // Build list of domains for the certificate
    const domains = [domain];
    if (alternateDomain) {
      domains.push(alternateDomain);
    }

    try {
      // Create order for all domains
      const order = await this.acmeClient.createOrder({
        identifiers: domains.map((d) => ({ type: 'dns', value: d })),
      });

      // Get authorizations for all domains
      const authorizations = await this.acmeClient.getAuthorizations(order);

      // Complete HTTP-01 challenge for each domain
      for (const authz of authorizations) {
        const challenge = authz.challenges.find((c) => c.type === 'http-01');

        if (!challenge) {
          throw new Error(`HTTP-01 challenge not available for ${authz.identifier.value}`);
        }

        // Write challenge file for nginx to serve
        const keyAuth = await this.acmeClient.getChallengeKeyAuthorization(challenge);
        await this.writeHttpChallenge(challenge.token, keyAuth);

        this.logger.log(`Completing HTTP-01 challenge for ${authz.identifier.value}`);

        // Complete challenge
        await this.acmeClient.completeChallenge(challenge);
        await this.acmeClient.waitForValidStatus(challenge);

        // Cleanup challenge file
        await this.removeHttpChallenge(challenge.token);
      }

      // Generate CSR with all domains
      const [key, csr] = await acme.crypto.createCsr({
        commonName: domain,
        altNames: alternateDomain ? [alternateDomain] : undefined,
      });

      // Finalize the order
      const finalizedOrder = await this.acmeClient.finalizeOrder(order, csr);
      this.logger.log(`Order status after finalize: ${finalizedOrder.status}`);

      // Wait for the order to become valid (certificate ready)
      // The order transitions: ready -> processing -> valid
      let validOrder = finalizedOrder;
      let attempts = 0;
      const maxAttempts = 30; // Wait up to 30 seconds

      while (validOrder.status === 'processing' && attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        validOrder = await this.acmeClient.getOrder(order);
        this.logger.log(`Waiting for certificate... Order status: ${validOrder.status}`);
        attempts++;
      }

      if (validOrder.status !== 'valid') {
        throw new Error(`Order did not become valid. Final status: ${validOrder.status}`);
      }

      const certificate = await this.acmeClient.getCertificate(validOrder);

      // Save certificate (use primary domain for path)
      await this.saveCustomDomainCertificate(domain, certificate, key);

      // If alternate domain included, create symlink so it can find the cert too
      if (alternateDomain) {
        await this.createCertSymlink(domain, alternateDomain);
      }

      const expiresAt = this.parseCertificateExpiry(certificate);

      this.logger.log(`Certificate issued for ${domains.join(', ')}`);
      return { success: true, expiresAt, domains };
    } catch (error) {
      this.logger.error(`Failed to get certificate for ${domains.join(', ')}: ${error}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Create symlink for alternate domain to use the same certificate
   */
  private async createCertSymlink(primaryDomain: string, alternateDomain: string): Promise<void> {
    const { symlink, rm } = await import('fs/promises');
    const primaryPath = join(this.getSslPath(), primaryDomain);
    const alternatePath = join(this.getSslPath(), alternateDomain);

    try {
      // Remove existing directory/symlink if exists
      await rm(alternatePath, { recursive: true, force: true });
      // Create symlink: alternatePath -> primaryPath
      await symlink(primaryPath, alternatePath, 'dir');
      this.logger.log(`Created cert symlink: ${alternateDomain} -> ${primaryDomain}`);
    } catch (error) {
      this.logger.warn(`Failed to create cert symlink: ${error}`);
      // Non-fatal - the cert still exists for primary domain
    }
  }

  /**
   * Ensure SSL certificate exists for a redirect source domain.
   * Requests a new certificate for the source domain via HTTP-01 challenge.
   * Note: Symlinks don't work because the certificate SANs must match the domain.
   * This is called when SSL is enabled on a redirect.
   */
  async ensureRedirectSslCert(
    sourceDomain: string,
    targetDomain: string,
  ): Promise<{ success: boolean; error?: string }> {
    const sourcePath = join(this.getSslPath(), sourceDomain);

    try {
      // Check if source already has a cert (not a symlink - symlinks don't work for SSL)
      try {
        const { lstat } = await import('fs/promises');
        const stats = await lstat(sourcePath);

        if (stats.isSymbolicLink()) {
          // Symlink exists but won't work - need actual cert
          this.logger.log(
            `Found symlink at ${sourceDomain} but symlinks don't work for SSL (SANs must match). ` +
              `Requesting new certificate.`,
          );
        } else {
          // Actual cert directory exists
          await access(join(sourcePath, 'fullchain.pem'));
          this.logger.log(`SSL cert already exists for ${sourceDomain}`);
          return { success: true };
        }
      } catch {
        // Source cert doesn't exist, need to request one
      }

      // Request new certificate for the redirect source domain
      this.logger.log(`Requesting SSL certificate for redirect source: ${sourceDomain}`);
      const result = await this.requestCustomDomainCertificate(sourceDomain);

      if (result.success) {
        this.logger.log(`SSL certificate issued for redirect source: ${sourceDomain}`);
        return { success: true };
      } else {
        return {
          success: false,
          error: result.error || `Failed to get SSL certificate for ${sourceDomain}`,
        };
      }
    } catch (error) {
      this.logger.error(`Failed to ensure SSL cert for redirect ${sourceDomain}: ${error}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set up SSL certificate',
      };
    }
  }

  /**
   * Remove SSL certificate for a redirect source domain.
   * Called when a redirect is deleted or SSL is disabled.
   * Removes both symlinks and actual certificate directories.
   */
  async removeRedirectSslCert(sourceDomain: string): Promise<void> {
    const { rm } = await import('fs/promises');
    const sourcePath = join(this.getSslPath(), sourceDomain);

    try {
      await rm(sourcePath, { recursive: true, force: true });
      this.logger.log(`Removed SSL certificate for redirect: ${sourceDomain}`);
    } catch (error) {
      // Path doesn't exist or other error - that's fine
      this.logger.debug(`No SSL certificate to remove for ${sourceDomain}: ${error}`);
    }
  }

  /**
   * @deprecated Use removeRedirectSslCert instead
   */
  async removeRedirectSslSymlink(sourceDomain: string): Promise<void> {
    return this.removeRedirectSslCert(sourceDomain);
  }

  /**
   * Check if wildcard certificate exists and get details
   */
  async checkWildcardCertificate(baseDomain: string): Promise<CertificateInfo> {
    // Mock mode: check in-memory mock certificates
    if (this.mockMode) {
      const mockExpiry = this.mockCertificates.get(baseDomain);
      if (mockExpiry) {
        const daysUntilExpiry = Math.floor(
          (mockExpiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
        );
        return {
          exists: true,
          isSelfSigned: false,
          issuer: 'Mock CA (MOCK_SSL=true)',
          expiresAt: mockExpiry,
          daysUntilExpiry,
        };
      }
      return { exists: false };
    }

    const certPath = join(this.getSslPath(), `wildcard.${baseDomain}.crt`);
    const keyPath = join(this.getSslPath(), `wildcard.${baseDomain}.key`);

    try {
      await access(certPath);
      await access(keyPath);

      const certPem = await readFile(certPath, 'utf-8');
      const certInfo = this.parseCertificateInfo(certPem);

      return {
        exists: true,
        isSelfSigned: certInfo.isSelfSigned,
        issuer: certInfo.issuer,
        expiresAt: certInfo.expiresAt,
        daysUntilExpiry: certInfo.daysUntilExpiry,
      };
    } catch {
      return { exists: false };
    }
  }

  /**
   * Check if custom domain certificate exists
   */
  async checkCustomDomainCertificate(domain: string): Promise<CertificateInfo> {
    const certPath = join(this.getSslPath(), domain, 'fullchain.pem');
    const keyPath = join(this.getSslPath(), domain, 'privkey.pem');

    try {
      await access(certPath);
      await access(keyPath);

      const certPem = await readFile(certPath, 'utf-8');
      const expiresAt = this.parseCertificateExpiry(certPem);
      const daysUntilExpiry = expiresAt
        ? Math.floor((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        : undefined;

      return { exists: true, expiresAt, daysUntilExpiry };
    } catch {
      return { exists: false };
    }
  }

  /**
   * Get pending DNS challenge for a domain (from database)
   */
  async getPendingChallenge(baseDomain: string): Promise<DnsChallenge | null> {
    const pending = await this.getPendingChallengeFromDb(baseDomain);
    if (!pending) return null;

    // Check if expired
    if (new Date(pending.expiresAt) <= new Date()) {
      await this.deleteChallengeFromDb(baseDomain);
      return null;
    }

    // Parse record values - may be JSON array or single value (backward compat)
    let recordValues: string[];
    try {
      recordValues = JSON.parse(pending.recordValue);
      if (!Array.isArray(recordValues)) {
        recordValues = [pending.recordValue];
      }
    } catch {
      recordValues = [pending.recordValue];
    }

    return {
      domain: pending.baseDomain,
      recordName: pending.recordName,
      recordValue: recordValues[0], // Primary value for backward compat
      recordValues,
      token: pending.token,
      expiresAt: new Date(pending.expiresAt),
    };
  }

  /**
   * Check if ACME client is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Delete wildcard certificate files
   */
  async deleteWildcardCertificate(baseDomain: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    // Mock mode: delete from in-memory store
    if (this.mockMode) {
      if (this.mockCertificates.has(baseDomain)) {
        this.mockCertificates.delete(baseDomain);
        await this.deleteChallengeFromDb(baseDomain);
        this.logger.log(`[MOCK] Deleted wildcard certificate for *.${baseDomain}`);
        return { success: true };
      }
      return { success: false, error: 'Certificate not found' };
    }

    const certPath = join(this.getSslPath(), `wildcard.${baseDomain}.crt`);
    const keyPath = join(this.getSslPath(), `wildcard.${baseDomain}.key`);

    try {
      // Check if files exist
      await access(certPath);
      await access(keyPath);

      // Delete certificate and key files
      await unlink(certPath);
      await unlink(keyPath);

      // Also delete any pending challenges for this domain
      await this.deleteChallengeFromDb(baseDomain);

      this.logger.log(`Deleted wildcard certificate for *.${baseDomain}`);
      return { success: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { success: false, error: 'Certificate files not found' };
      }
      this.logger.error(`Failed to delete wildcard certificate: ${error}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Cancel pending certificate challenge
   */
  async cancelPendingChallenge(baseDomain: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      const existing = await this.getPendingChallengeFromDb(baseDomain);
      if (!existing) {
        return { success: false, error: 'No pending challenge found' };
      }

      await this.deleteChallengeFromDb(baseDomain);
      this.logger.log(`Cancelled pending challenge for ${baseDomain}`);
      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to cancel pending challenge: ${error}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Check DNS propagation for pending challenge
   * Returns which TXT record values have been detected
   */
  async checkDnsPropagation(baseDomain: string): Promise<{
    recordName: string;
    expectedValues: string[];
    foundValues: string[];
    allFound: boolean;
    missingValues: string[];
    error?: string;
  }> {
    // Mock mode: always return DNS records as found
    if (this.mockMode) {
      const pending = await this.getPendingChallenge(baseDomain);
      if (!pending) {
        return {
          recordName: `_acme-challenge.${baseDomain}`,
          expectedValues: [],
          foundValues: [],
          allFound: false,
          missingValues: [],
          error: 'No pending certificate request found. Please start a new request.',
        };
      }
      this.logger.log(`[MOCK] DNS propagation check for ${baseDomain} - simulating all records found`);
      return {
        recordName: pending.recordName,
        expectedValues: pending.recordValues,
        foundValues: pending.recordValues, // Pretend all records are found
        allFound: true,
        missingValues: [],
      };
    }

    const pending = await this.getPendingChallenge(baseDomain);
    if (!pending) {
      return {
        recordName: `_acme-challenge.${baseDomain}`,
        expectedValues: [],
        foundValues: [],
        allFound: false,
        missingValues: [],
        error: 'No pending certificate request found. Please start a new request.',
      };
    }

    const recordName = pending.recordName;
    const expectedValues = pending.recordValues;

    let foundValues: string[] = [];
    try {
      // Query TXT records for _acme-challenge.domain
      const records = await dns.resolveTxt(recordName);
      // resolveTxt returns array of arrays (each TXT record can have multiple strings)
      foundValues = records.map((r) => r.join('')).filter(Boolean);
      this.logger.log(`DNS lookup for ${recordName}: found ${foundValues.length} TXT records`);
    } catch (error) {
      // ENODATA or ENOTFOUND means no records found
      if (
        (error as NodeJS.ErrnoException).code === 'ENODATA' ||
        (error as NodeJS.ErrnoException).code === 'ENOTFOUND'
      ) {
        this.logger.log(`DNS lookup for ${recordName}: no TXT records found`);
      } else {
        this.logger.warn(`DNS lookup error for ${recordName}: ${error}`);
      }
    }

    // Check which expected values are present
    const missingValues = expectedValues.filter((expected) => !foundValues.includes(expected));
    const allFound = missingValues.length === 0;

    return {
      recordName,
      expectedValues,
      foundValues,
      allFound,
      missingValues,
    };
  }

  // Database helper methods

  private async saveChallengeToDb(data: {
    baseDomain: string;
    challengeType: string;
    recordName: string;
    recordValue: string;
    token: string;
    orderData: string;
    authzData: string;
    keyAuthorization: string;
    status: string;
    expiresAt: Date;
  }): Promise<void> {
    await db
      .insert(sslChallenges)
      .values(data)
      .onConflictDoUpdate({
        target: sslChallenges.baseDomain,
        set: {
          challengeType: data.challengeType,
          recordName: data.recordName,
          recordValue: data.recordValue,
          token: data.token,
          orderData: data.orderData,
          authzData: data.authzData,
          keyAuthorization: data.keyAuthorization,
          status: data.status,
          expiresAt: data.expiresAt,
          updatedAt: new Date(),
        },
      });
  }

  private async getPendingChallengeFromDb(baseDomain: string): Promise<SslChallenge | null> {
    const results = await db
      .select()
      .from(sslChallenges)
      .where(and(eq(sslChallenges.baseDomain, baseDomain), eq(sslChallenges.status, 'pending')))
      .limit(1);

    return results[0] || null;
  }

  private async updateChallengeStatus(
    baseDomain: string,
    status: 'pending' | 'verified' | 'failed' | 'expired',
  ): Promise<void> {
    await db
      .update(sslChallenges)
      .set({ status, updatedAt: new Date() })
      .where(eq(sslChallenges.baseDomain, baseDomain));
  }

  private async deleteChallengeFromDb(baseDomain: string): Promise<void> {
    await db.delete(sslChallenges).where(eq(sslChallenges.baseDomain, baseDomain));
  }

  // Private helper methods

  private async getOrCreateAccountKey(): Promise<Buffer> {
    const keyPath = join(this.getSslPath(), 'acme-account.key');
    try {
      return await readFile(keyPath);
    } catch {
      const key = await acme.crypto.createPrivateKey();
      await mkdir(this.getSslPath(), { recursive: true });
      await writeFile(keyPath, key);
      this.logger.log('Created new ACME account key');
      return key;
    }
  }

  private async saveWildcardCertificate(
    baseDomain: string,
    certificate: string,
    key: Buffer,
  ): Promise<void> {
    const sslPath = this.getSslPath();
    await mkdir(sslPath, { recursive: true });
    await writeFile(join(sslPath, `wildcard.${baseDomain}.crt`), certificate);
    await writeFile(join(sslPath, `wildcard.${baseDomain}.key`), key);
    this.logger.log(`Saved wildcard certificate to ${sslPath}`);
  }

  private async saveCustomDomainCertificate(
    domain: string,
    certificate: string,
    key: Buffer,
  ): Promise<void> {
    const { lstat, rm } = await import('fs/promises');
    const domainPath = join(this.getSslPath(), domain);

    // Check if path is a symlink - if so, remove it first
    // This prevents overwriting another domain's certificate when following symlinks
    try {
      const stats = await lstat(domainPath);
      if (stats.isSymbolicLink()) {
        this.logger.log(
          `Removing symlink at ${domainPath} before saving certificate (prevents overwriting linked cert)`,
        );
        await rm(domainPath);
      }
    } catch {
      // Path doesn't exist, that's fine
    }

    await mkdir(domainPath, { recursive: true });
    await writeFile(join(domainPath, 'fullchain.pem'), certificate);
    await writeFile(join(domainPath, 'privkey.pem'), key);
    this.logger.log(`Saved certificate for ${domain} to ${domainPath}`);
  }

  private async writeHttpChallenge(token: string, content: string): Promise<void> {
    const challengePath = join(
      process.env.CERTBOT_WEBROOT || '/var/www/certbot',
      '.well-known/acme-challenge',
    );
    await mkdir(challengePath, { recursive: true });
    await writeFile(join(challengePath, token), content);
    this.logger.log(`Wrote HTTP challenge token: ${token}`);
  }

  private async removeHttpChallenge(token: string): Promise<void> {
    const challengePath = join(
      process.env.CERTBOT_WEBROOT || '/var/www/certbot',
      '.well-known/acme-challenge',
      token,
    );
    try {
      await unlink(challengePath);
    } catch {
      // Ignore if file doesn't exist
    }
  }

  private parseCertificateExpiry(certPem: string): Date | undefined {
    try {
      const cert = forge.pki.certificateFromPem(certPem);
      return cert.validity.notAfter;
    } catch (error) {
      this.logger.warn(`Failed to parse certificate expiry: ${error}`);
      return undefined;
    }
  }

  private parseCertificateInfo(certPem: string): {
    isSelfSigned: boolean;
    issuer: string;
    expiresAt?: Date;
    daysUntilExpiry?: number;
  } {
    try {
      const cert = forge.pki.certificateFromPem(certPem);
      const expiresAt = cert.validity.notAfter;
      const daysUntilExpiry = expiresAt
        ? Math.floor((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        : undefined;

      // Get issuer common name
      const issuerCN = cert.issuer.getField('CN');
      const issuer = issuerCN ? String(issuerCN.value) : 'Unknown';

      // Get subject common name
      const subjectCN = cert.subject.getField('CN');
      const subject = subjectCN ? String(subjectCN.value) : 'Unknown';

      // A certificate is self-signed if the issuer equals the subject
      // Also check if issuer contains known CA names
      const knownCAs = [
        "Let's Encrypt",
        'DigiCert',
        'Comodo',
        'GoDaddy',
        'GlobalSign',
        'Sectigo',
        'R3',
        'E1',
      ];
      const isFromKnownCA = knownCAs.some((ca) => issuer.includes(ca));
      const isSelfSigned = !isFromKnownCA && issuer === subject;

      return { isSelfSigned, issuer, expiresAt, daysUntilExpiry };
    } catch (error) {
      this.logger.warn(`Failed to parse certificate info: ${error}`);
      return { isSelfSigned: true, issuer: 'Unknown' };
    }
  }

  private getSslPath(): string {
    return process.env.SSL_CERT_PATH || '/etc/nginx/ssl';
  }

  // ============================================================================
  // Mock Mode Helper Methods
  // ============================================================================

  /**
   * Mock: Start wildcard certificate request - returns fake challenge data
   */
  private async startMockWildcardCertificateRequest(baseDomain: string): Promise<DnsChallenge> {
    // Check for existing pending challenge in DB
    const existing = await this.getPendingChallengeFromDb(baseDomain);
    if (existing) {
      if (new Date(existing.expiresAt) > new Date()) {
        this.logger.log(`[MOCK] Returning existing pending challenge for *.${baseDomain}`);
        let recordValues: string[];
        try {
          recordValues = JSON.parse(existing.recordValue);
          if (!Array.isArray(recordValues)) {
            recordValues = [existing.recordValue];
          }
        } catch {
          recordValues = [existing.recordValue];
        }
        return {
          domain: existing.baseDomain,
          recordName: existing.recordName,
          recordValue: recordValues[0],
          recordValues,
          token: existing.token,
          expiresAt: new Date(existing.expiresAt),
        };
      }
      await this.deleteChallengeFromDb(baseDomain);
    }

    // Generate fake challenge data
    const mockToken = `mock-token-${Date.now().toString(36)}`;
    const mockKeyAuth1 = `mock-auth-wildcard-${Buffer.from(baseDomain).toString('base64').slice(0, 20)}`;
    const mockKeyAuth2 = `mock-auth-base-${Buffer.from(baseDomain).toString('base64').slice(0, 20)}`;
    const recordValues = [mockKeyAuth1, mockKeyAuth2];
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    const recordName = `_acme-challenge.${baseDomain}`;

    // Store in database (same as real flow, but with fake data)
    await this.saveChallengeToDb({
      baseDomain,
      challengeType: 'dns-01',
      recordName,
      recordValue: JSON.stringify(recordValues),
      token: mockToken,
      orderData: JSON.stringify({ mock: true, url: 'mock://order' }),
      authzData: JSON.stringify([{ mock: true }]),
      keyAuthorization: recordValues[0],
      status: 'pending',
      expiresAt,
    });

    this.logger.log(`[MOCK] Started wildcard certificate request for *.${baseDomain}`);
    this.logger.log(`[MOCK] TXT records to add (not actually needed in mock mode):`);
    this.logger.log(`[MOCK]   ${recordName} -> ${recordValues.join(', ')}`);

    return {
      domain: baseDomain,
      recordName,
      recordValue: recordValues[0],
      recordValues,
      token: mockToken,
      expiresAt,
    };
  }

  /**
   * Mock: Complete wildcard certificate request - simulates success
   */
  private async completeMockWildcardCertificateRequest(baseDomain: string): Promise<{
    success: boolean;
    error?: string;
    expiresAt?: Date;
  }> {
    const pending = await this.getPendingChallengeFromDb(baseDomain);
    if (!pending) {
      return { success: false, error: 'No pending certificate request found' };
    }

    // Simulate processing delay (1 second)
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Generate mock certificate expiry (90 days from now, like Let's Encrypt)
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

    // Store in mock certificates map
    this.mockCertificates.set(baseDomain, expiresAt);

    // Update challenge status
    await this.updateChallengeStatus(baseDomain, 'verified');

    this.logger.log(`[MOCK] Wildcard certificate issued for *.${baseDomain}`);
    this.logger.log(`[MOCK] Certificate expires: ${expiresAt.toISOString()}`);
    this.logger.log(`[MOCK] Note: This is a mock certificate - no real cert files were created`);

    return { success: true, expiresAt };
  }

  /**
   * Mock: Delete wildcard certificate
   */
  async deleteMockWildcardCertificate(baseDomain: string): Promise<void> {
    if (this.mockMode) {
      this.mockCertificates.delete(baseDomain);
      await this.deleteChallengeFromDb(baseDomain);
      this.logger.log(`[MOCK] Deleted wildcard certificate for *.${baseDomain}`);
    }
  }
}
