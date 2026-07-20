import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import * as forge from 'node-forge';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { SetupService } from './setup.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';

/**
 * Plausible-hostname check for a bootstrap domain. This value is user-supplied
 * and gets interpolated directly into filenames (`wildcard.<domain>.crt`), so
 * it must never contain path separators, `..`, or anything else that could
 * escape the SSL directory. Requires at least two DNS labels (a base domain,
 * not a bare TLD/single label) and a total length within RFC 1035 limits.
 */
const HOSTNAME_RE =
  /^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;

@Injectable()
export class BootstrapSetupService {
  constructor(
    private readonly setupService: SetupService,
    private readonly featureFlags: FeatureFlagsService,
  ) {}

  /**
   * Same resolution as `ssl-certificate.service.ts` `getSslPath()` (line ~1039):
   * `SSL_CERT_PATH` env override, else the default nginx SSL volume path.
   * Duplicated intentionally rather than importing the 1000+ line ACME service.
   */
  private sslDir(): string {
    return process.env.SSL_CERT_PATH || '/etc/nginx/ssl';
  }

  /**
   * Rejects anything that isn't a plausible hostname. `domain` is user input
   * that gets interpolated into a filename (`wildcard.<domain>.crt/.key`), so
   * this is a path-traversal guard, not just cosmetic validation.
   */
  private assertValidDomain(domain: string): void {
    if (
      typeof domain !== 'string' ||
      domain.length === 0 ||
      domain.length > 253 ||
      domain.includes('/') ||
      domain.includes('\\') ||
      domain.includes('..') ||
      domain.includes('\0') ||
      !HOSTNAME_RE.test(domain)
    ) {
      throw new BadRequestException('Invalid domain name');
    }
  }

  /**
   * Guard called first by every bootstrap endpoint (Task 6). Platform-managed
   * deployments (Traefik/Platform terminates SSL) must never expose bootstrap
   * mode, regardless of the feature flag.
   */
  async assertBootstrapAllowed(): Promise<void> {
    if (this.setupService.isPlatformManaged()) {
      throw new ForbiddenException('Not available on platform-managed deployments');
    }
    if (!(await this.featureFlags.isEnabled('ENABLE_BOOTSTRAP_SETUP'))) {
      throw new BadRequestException('Bootstrap setup is disabled');
    }
  }

  /**
   * Validates a Cloudflare Origin Certificate (or any cert/key pair) BEFORE
   * it is ever written to the nginx SSL volume. A bad pair written to disk
   * would leave nginx unable to start, taking the box offline with no SSH
   * recovery path in bootstrap mode — so every failure mode here must throw
   * rather than silently pass.
   *
   * Only RSA key pairs are supported. node-forge's `certificateFromPem` /
   * `privateKeyFromPem` both throw on EC (P-256/P-384) material — verified
   * empirically, not assumed — so a mismatched or well-formed-but-EC pair
   * never reaches the modulus comparison below; it's rejected up front by
   * the parse try/catch. The explicit RSA-shape check further down is
   * defense-in-depth in case a future forge version starts returning a
   * partially-populated key object instead of throwing.
   */
  validateCertificatePair(certPem: string, keyPem: string, domain: string): { sans: string[] } {
    this.assertValidDomain(domain);

    let cert: forge.pki.Certificate;
    let key: forge.pki.rsa.PrivateKey;
    try {
      cert = forge.pki.certificateFromPem(certPem);
      key = forge.pki.privateKeyFromPem(keyPem) as forge.pki.rsa.PrivateKey;
    } catch {
      throw new BadRequestException(
        'Could not parse certificate or private key PEM (only RSA is supported)',
      );
    }

    const certPublicKey = cert.publicKey as forge.pki.rsa.PublicKey;
    if (
      !certPublicKey ||
      typeof certPublicKey.n === 'undefined' ||
      !key ||
      typeof key.n === 'undefined'
    ) {
      // Defense-in-depth: should be unreachable given the parse behavior
      // above, but never treat an unknown key shape as "matching".
      throw new BadRequestException('Only RSA certificates and keys are supported');
    }

    const modulusMatches = certPublicKey.n.toString(16) === key.n.toString(16);
    const exponentMatches = certPublicKey.e.toString(16) === key.e.toString(16);
    if (!modulusMatches || !exponentMatches) {
      throw new BadRequestException('Private key does not match the certificate');
    }

    const now = new Date();
    if (now > cert.validity.notAfter) {
      throw new BadRequestException('Certificate is expired');
    }
    if (now < cert.validity.notBefore) {
      throw new BadRequestException('Certificate is not yet valid');
    }

    const sanExt = cert.getExtension('subjectAltName') as
      | { altNames?: { value: string }[] }
      | undefined;
    const sans = (sanExt?.altNames || []).map((a) => a.value);
    const covers = (name: string) => sans.includes(name);
    if (!covers(domain)) {
      throw new BadRequestException(`Certificate does not cover ${domain}`);
    }
    if (!covers(`*.${domain}`)) {
      throw new BadRequestException(
        `Certificate does not cover the wildcard *.${domain} (needed for admin/www/preview subdomains)`,
      );
    }
    return { sans };
  }

  /**
   * Writes the four cert/key files nginx expects, atomically per-file
   * (write to a same-directory tmp name, then rename) so a partially
   * written file is never observed by the nginx inotify watcher. The two
   * files of each pair (cert immediately followed by its key) are written
   * back-to-back to minimize the window where a watcher could reload with
   * a stale/mismatched pair for that specific filename set; nginx config
   * tests its certs before applying a reload, so a caught-mid-write reload
   * fails closed (keeps serving the previous config) rather than crashing —
   * see task-5-report.md for the full residual-risk note.
   */
  saveCertificates(certPem: string, keyPem: string, domain: string): void {
    this.assertValidDomain(domain);
    const dir = this.sslDir();
    fs.mkdirSync(dir, { recursive: true });

    const write = (name: string, content: string, mode: number) => {
      const tmp = path.join(dir, `.${name}.${process.pid}-${crypto.randomBytes(4).toString('hex')}.tmp`);
      // `mode` is requested at creation time (masked by umask, which can
      // only narrow it further, never widen it) so a 0o600 key is never
      // briefly world- or group-readable. chmodSync afterwards is
      // belt-and-suspenders: it guarantees the FINAL mode regardless of
      // umask, which matters for the 0o644 cert files (a restrictive
      // umask could otherwise leave them unreadable by the nginx worker).
      fs.writeFileSync(tmp, content, { mode });
      fs.chmodSync(tmp, mode);
      fs.renameSync(tmp, path.join(dir, name));
    };

    write('fullchain.pem', certPem, 0o644);
    write('privkey.pem', keyPem, 0o600);
    write(`wildcard.${domain}.crt`, certPem, 0o644);
    write(`wildcard.${domain}.key`, keyPem, 0o600);
  }

  /**
   * Belongs here (not the Task 6 controller) since it reads the same SSL
   * directory this service owns. Checks the generic pair plus the
   * domain-specific wildcard cert so the wizard can tell whether bootstrap
   * has already completed for this domain.
   */
  certificatesPresent(domain: string): boolean {
    this.assertValidDomain(domain);
    const dir = this.sslDir();
    return (
      fs.existsSync(path.join(dir, 'fullchain.pem')) &&
      fs.existsSync(path.join(dir, 'privkey.pem')) &&
      fs.existsSync(path.join(dir, `wildcard.${domain}.crt`))
    );
  }
}
