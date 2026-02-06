import { Injectable, Logger } from '@nestjs/common';
import { X509Certificate } from 'crypto';
import { readFile, access } from 'fs/promises';
import { join } from 'path';

export interface SslCertificateInfo {
  type: 'wildcard' | 'individual';
  commonName: string;
  issuer: string;
  issuedAt: Date;
  expiresAt: Date;
  daysUntilExpiry: number;
  isValid: boolean;
  isExpiringSoon: boolean; // < 30 days
  serialNumber: string;
  fingerprint: string;
}

export interface DomainSslInfo extends SslCertificateInfo {
  domainId: string;
  domain: string;
  sslEnabled: boolean;
  autoRenewEnabled: boolean;
  lastRenewalAt: Date | null;
  lastRenewalStatus: 'success' | 'failed' | null;
  wildcardCertDomain?: string; // If using wildcard, show which one
}

@Injectable()
export class SslInfoService {
  private readonly logger = new Logger(SslInfoService.name);

  /**
   * Get SSL certificate info for a domain
   */
  async getDomainSslInfo(
    domain: string,
    domainType: 'subdomain' | 'custom',
  ): Promise<SslCertificateInfo | null> {
    try {
      const certPath = this.getCertPath(domain, domainType);
      const certContent = await readFile(certPath, 'utf-8');
      return this.parseCertificate(certContent, domainType);
    } catch (error) {
      this.logger.warn(`Failed to read certificate for ${domain}: ${error}`);
      return null;
    }
  }

  /**
   * Get wildcard certificate info
   */
  async getWildcardCertInfo(): Promise<SslCertificateInfo | null> {
    const baseDomain = process.env.PRIMARY_DOMAIN || 'localhost';
    const certPath = join(this.getSslPath(), `wildcard.${baseDomain}.crt`);

    try {
      const certContent = await readFile(certPath, 'utf-8');
      return this.parseCertificate(certContent, 'wildcard');
    } catch (error) {
      this.logger.warn(`Wildcard certificate not found: ${error}`);
      return null;
    }
  }

  /**
   * Get SSL certificate info for system app domains
   * These domains have individual certificates (not wildcard)
   */
  async getAppDomainCertInfo(appName: string): Promise<SslCertificateInfo | null> {
    const baseDomain = process.env.PRIMARY_DOMAIN || 'localhost';
    const domain = `${appName}.${baseDomain}`;

    // App domains have individual certs in their own directories
    const certPath = join(this.getSslPath(), domain, 'fullchain.pem');

    try {
      const certContent = await readFile(certPath, 'utf-8');
      return this.parseCertificate(certContent, 'individual');
    } catch (error) {
      this.logger.warn(`App domain certificate not found for ${domain}: ${error}`);
      return null;
    }
  }

  /**
   * Check if certificate exists for domain
   */
  async certificateExists(domain: string, domainType: 'subdomain' | 'custom'): Promise<boolean> {
    try {
      const certPath = this.getCertPath(domain, domainType);
      const keyPath = this.getKeyPath(domain, domainType);
      await access(certPath);
      await access(keyPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Parse X.509 certificate and extract info
   */
  parseCertificate(
    pemContent: string,
    type: 'wildcard' | 'subdomain' | 'custom' | 'individual',
  ): SslCertificateInfo {
    const cert = new X509Certificate(pemContent);

    const expiresAt = new Date(cert.validTo);
    const issuedAt = new Date(cert.validFrom);
    const now = new Date();
    const daysUntilExpiry = Math.floor(
      (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );

    // Parse common name from subject
    const commonName = this.parseCommonName(cert.subject);

    // Parse issuer organization
    const issuer = this.parseIssuer(cert.issuer);

    return {
      type: type === 'wildcard' || type === 'subdomain' ? 'wildcard' : 'individual',
      commonName,
      issuer,
      issuedAt,
      expiresAt,
      daysUntilExpiry,
      isValid: now < expiresAt && now >= issuedAt,
      isExpiringSoon: daysUntilExpiry <= 30,
      serialNumber: cert.serialNumber,
      fingerprint: cert.fingerprint256,
    };
  }

  private parseCommonName(subject: string): string {
    const cnMatch = subject.match(/CN=([^,\n]+)/);
    return cnMatch ? cnMatch[1] : 'Unknown';
  }

  private parseIssuer(issuer: string): string {
    const orgMatch = issuer.match(/O=([^,\n]+)/);
    if (orgMatch) return orgMatch[1];

    const cnMatch = issuer.match(/CN=([^,\n]+)/);
    return cnMatch ? cnMatch[1] : 'Unknown';
  }

  private getCertPath(domain: string, domainType: 'subdomain' | 'custom'): string {
    const baseDomain = process.env.PRIMARY_DOMAIN || 'localhost';

    if (domainType === 'subdomain') {
      // Subdomains use wildcard cert
      return join(this.getSslPath(), `wildcard.${baseDomain}.crt`);
    }

    // Custom domains have individual certs
    return join(this.getSslPath(), domain, 'fullchain.pem');
  }

  private getKeyPath(domain: string, domainType: 'subdomain' | 'custom'): string {
    const baseDomain = process.env.PRIMARY_DOMAIN || 'localhost';

    if (domainType === 'subdomain') {
      return join(this.getSslPath(), `wildcard.${baseDomain}.key`);
    }

    return join(this.getSslPath(), domain, 'privkey.pem');
  }

  private getSslPath(): string {
    return process.env.SSL_CERT_PATH || '/etc/nginx/ssl';
  }
}
