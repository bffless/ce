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
   * Claim-token check for the cert/apply endpoints. The setup wizard is a
   * fully anonymous, session-less flow (every setup step is public), so these
   * endpoints cannot be admin-session-guarded — there is never a session to
   * present. Instead they reuse the SAME rate-limited claim token that gates
   * admin creation, which is the real security boundary on a public IP.
   *
   * Delegates to the existing validator: throws UnauthorizedException on a
   * wrong token (after the rate-limit window), and is OPEN when no
   * ONBOARDING_TOKEN is configured (LAN/Umbrel profile) — identical semantics
   * to admin creation, so the two can never disagree.
   */
  validateClaimToken(token?: string): void {
    this.setupService.validateOnboardingToken(token);
  }

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
   *
   * Returns the validated domain lowercased: DNS is case-insensitive, but the
   * domain is used verbatim as part of a filename, so `saveCertificates`
   * writing `wildcard.Example.com.crt` and `certificatesPresent` later
   * looking for `wildcard.example.com.crt` would silently disagree unless
   * every call site normalizes through this return value.
   */
  private assertValidDomain(domain: string): string {
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
    return domain.toLowerCase();
  }

  /**
   * Public wrapper around assertValidDomain, for callers (Task 6's apply()
   * controller) that write the domain into a file or a response themselves
   * rather than going through validateCertificatePair/saveCertificates/
   * certificatesPresent (which already validate as a side effect of their
   * real job). apply() calls writeInstanceConfig directly, and that value
   * gets written verbatim into instance.env, which the nginx render script
   * `source`s as shell — so it must be explicitly validated and normalized
   * (not merely happen to be safe because some other call validated it
   * first), and normalized the same way saveCertificates/certificatesPresent
   * already are, so the persisted primaryDomain always matches the
   * lowercased filenames on disk.
   */
  validateDomain(domain: string): string {
    return this.assertValidDomain(domain);
  }

  /**
   * Guard called first by every bootstrap endpoint (Task 6). Platform-managed
   * deployments (Traefik/Platform terminates SSL) must never expose bootstrap
   * mode, regardless of the feature flag.
   *
   * The first two checks exist for their specific error messages; the final
   * isBootstrapModeActive check closes the rest of the gate: an
   * already-applied instance, a completed setup, or a legacy install that was
   * never cert-less must not be able to reach the cert-write/apply paths at
   * all. Without it, any admin session on a working install (the flag
   * defaults to ON) could clobber the live fullchain.pem/privkey.pem or
   * rewrite instance.json to a new identity — remotely, with no SSH recovery
   * path. The endpoints must be callable exactly when getSetupStatus would
   * report bootstrapMode=true, so both defer to the same SetupService method.
   */
  async assertBootstrapAllowed(): Promise<void> {
    if (this.setupService.isPlatformManaged()) {
      throw new ForbiddenException('Not available on platform-managed deployments');
    }
    if (!(await this.featureFlags.isEnabled('ENABLE_BOOTSTRAP_SETUP'))) {
      throw new BadRequestException('Bootstrap setup is disabled');
    }
    if (!(await this.setupService.isBootstrapModeActive())) {
      throw new ForbiddenException('Bootstrap setup is not active on this instance');
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
    const validatedDomain = this.assertValidDomain(domain);

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

    const sans = this.dnsSans(cert);
    this.assertSansCover(sans, validatedDomain);
    return { sans };
  }

  /**
   * GeneralName type 2 is dNSName (RFC 5280). Other SAN types (e.g. type 7,
   * iPAddress) share the same `.value`/`.ip` shape in node-forge and must
   * never be treated as a DNS name a hostname check can match against.
   */
  private dnsSans(cert: forge.pki.Certificate): string[] {
    const sanExt = cert.getExtension('subjectAltName') as
      | { altNames?: { type: number; value: string }[] }
      | undefined;
    return (sanExt?.altNames || []).filter((a) => a.type === 2).map((a) => a.value);
  }

  /**
   * DNS is case-insensitive and cert SANs are commonly issued in mixed case,
   * so compare against the lowercased, validated domain. Requires BOTH the
   * apex and the wildcard (admin/www/preview subdomains all ride on it).
   */
  private assertSansCover(sans: string[], validatedDomain: string): void {
    const lowerSans = sans.map((s) => s.toLowerCase());
    if (!lowerSans.includes(validatedDomain)) {
      throw new BadRequestException(`Certificate does not cover ${validatedDomain}`);
    }
    if (!lowerSans.includes(`*.${validatedDomain}`)) {
      throw new BadRequestException(
        `Certificate does not cover the wildcard *.${validatedDomain} (needed for admin/www/preview subdomains)`,
      );
    }
  }

  /**
   * Re-validates that the staged generic cert (`fullchain.pem` — the file
   * nginx's apex/www/admin vhosts serve) actually covers `domain`.
   * certificatesPresent alone can't catch the change-of-mind sequence
   * "upload certs for A, upload certs for B, apply A": the domain-suffixed
   * wildcard.A.* files still exist from the first upload, but
   * fullchain.pem/privkey.pem now hold B's material (saveCertificates
   * overwrites the generic pair on every upload). Applying A would bring
   * nginx up serving A's hostnames with B's certificate — cert errors on the
   * exact URLs the post-apply redirect targets, on a box with no SSH
   * recovery path. Called by the apply endpoint AFTER certificatesPresent
   * (so the file is known to exist); any read/parse failure throws rather
   * than passes.
   */
  assertStagedCertificateCovers(domain: string): void {
    const validatedDomain = this.assertValidDomain(domain);
    let cert: forge.pki.Certificate;
    try {
      const pem = fs.readFileSync(path.join(this.sslDir(), 'fullchain.pem'), 'utf8');
      cert = forge.pki.certificateFromPem(pem);
    } catch {
      throw new BadRequestException(
        'Installed certificate could not be read — re-install the certificate for this domain',
      );
    }
    this.assertSansCover(this.dnsSans(cert), validatedDomain);
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
    const validatedDomain = this.assertValidDomain(domain);
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
    write(`wildcard.${validatedDomain}.crt`, certPem, 0o644);
    write(`wildcard.${validatedDomain}.key`, keyPem, 0o600);
  }

  /**
   * Belongs here (not the Task 6 controller) since it reads the same SSL
   * directory this service owns. Checks all four files `saveCertificates`
   * writes — the generic pair AND the domain-specific wildcard cert/key —
   * so the wizard can tell whether bootstrap has already completed for this
   * domain. The four writes are not one transaction, so an interrupted save
   * must not be reported as complete just because the first three files
   * landed; omitting the wildcard key here would let the Task 6 apply
   * endpoint report success while nginx still lacks the key for that vhost.
   */
  certificatesPresent(domain: string): boolean {
    const validatedDomain = this.assertValidDomain(domain);
    const dir = this.sslDir();
    return (
      fs.existsSync(path.join(dir, 'fullchain.pem')) &&
      fs.existsSync(path.join(dir, 'privkey.pem')) &&
      fs.existsSync(path.join(dir, `wildcard.${validatedDomain}.crt`)) &&
      fs.existsSync(path.join(dir, `wildcard.${validatedDomain}.key`))
    );
  }
}
