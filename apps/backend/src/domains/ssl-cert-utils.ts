import { X509Certificate } from 'crypto';

/**
 * True when a PEM certificate genuinely carries the `*.<domain>` SAN.
 *
 * Distinguishes a real wildcard certificate (issued via the DNS-01 flow, or
 * a pasted Cloudflare Origin cert) from a `wildcard.<domain>.crt` that is
 * merely a same-named COPY of the HTTP-01 primary-domain cert — HTTP-01 can
 * only ever cover the fixed SAN set [apex, www, admin], never `*.<domain>`,
 * so a copy without this SAN is not a real wildcard no matter what it's
 * named on disk.
 *
 * Shared by SslCertificateService (checkWildcardCertificate,
 * installedWildcardIsReal) and SslInfoService (getWildcardCertInfo) so both
 * readers of `wildcard.<domain>.crt` agree on what "a wildcard exists"
 * means.
 */
export function certPemHasWildcardSan(certPem: string | Buffer, domain: string): boolean {
  try {
    const cert = new X509Certificate(certPem);
    return (cert.subjectAltName ?? '').includes(`DNS:*.${domain}`);
  } catch {
    return false;
  }
}
