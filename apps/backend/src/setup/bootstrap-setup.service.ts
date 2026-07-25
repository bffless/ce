import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { X509Certificate, createPrivateKey } from 'crypto';
import { isIP } from 'net';
import { SetupService } from './setup.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { ApplyBootstrapDto } from './setup.dto';
import {
  AppliedConfig,
  Port80Mode,
  ProxyMode,
  RealIpConfig,
  SHELL_SAFE_HEADER_RE,
} from '../bootstrap/instance-config';
import { sslLiveDir, sslStagingDir, discardStagedCertificates } from './ssl-staging';

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
  validateClaimToken(token?: string, clientIp?: string): void {
    this.setupService.validateOnboardingToken(token, clientIp);
  }

  /**
   * Mark setup complete as part of apply — the bootstrap flow's terminal step.
   * Without this the restarted backend bounces the user back into the wizard
   * (see SetupService.finalizeBootstrapSetup).
   */
  async finalizeSetup(): Promise<void> {
    await this.setupService.finalizeBootstrapSetup();
  }

  async unfinalizeSetup(): Promise<void> {
    await this.setupService.unfinalizeBootstrapSetup();
  }

  /** Live cert dir — delegates to ssl-staging.ts so there is one resolution. */
  private sslDir(): string {
    return sslLiveDir();
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
    // Trim first: a leading/trailing space is an accidental paste artifact
    // (e.g. "example.com "), not a different domain, and rejecting it outright
    // surfaced as an opaque 400 on issue-certificate/apply. Trimming normalizes
    // it; the strict checks below still reject genuinely malformed input
    // (internal whitespace fails HOSTNAME_RE, so typos aren't silently accepted).
    const d = typeof domain === 'string' ? domain.trim() : domain;
    if (
      typeof d !== 'string' ||
      d.length === 0 ||
      d.length > 253 ||
      d.includes('/') ||
      d.includes('\\') ||
      d.includes('..') ||
      d.includes('\0') ||
      !HOSTNAME_RE.test(d)
    ) {
      throw new BadRequestException('Invalid domain name');
    }
    return d.toLowerCase();
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
   * Uses `node:crypto`'s `X509Certificate`/`createPrivateKey` rather than
   * node-forge, so browser-trusted ECDSA (P-256/P-384) certs are accepted
   * alongside RSA — forge can only parse RSA material.
   */
  validateCertificatePair(
    certPem: string,
    keyPem: string,
    domain: string,
    servingMode: ProxyMode,
  ): { sans: string[]; wildcardCovered: boolean } {
    const validatedDomain = this.assertValidDomain(domain);

    let cert: X509Certificate;
    let key: ReturnType<typeof createPrivateKey>;
    try {
      cert = new X509Certificate(certPem);
    } catch {
      throw new BadRequestException('Could not parse certificate PEM');
    }
    try {
      key = createPrivateKey(keyPem);
    } catch {
      throw new BadRequestException('Could not parse private key PEM');
    }

    // Works for RSA and EC alike — this replaces the old modulus comparison
    // (node-forge, RSA-only) so browser-trusted ECDSA certs stop being rejected.
    if (!cert.checkPrivateKey(key)) {
      throw new BadRequestException('Private key does not match the certificate');
    }

    const now = Date.now();
    if (now > new Date(cert.validTo).getTime()) {
      throw new BadRequestException('Certificate is expired');
    }
    if (now < new Date(cert.validFrom).getTime()) {
      throw new BadRequestException('Certificate is not yet valid');
    }

    const sans = this.dnsSans(cert);
    const wildcardCovered = this.checkSansCover(sans, validatedDomain, servingMode);
    return { sans, wildcardCovered };
  }

  /**
   * X509Certificate.subjectAltName is a comma-separated string like
   * "DNS:example.com, DNS:*.example.com, IP Address:1.2.3.4" — only DNS
   * entries are hostnames a policy check may match against.
   */
  private dnsSans(cert: X509Certificate): string[] {
    return (cert.subjectAltName ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.startsWith('DNS:'))
      .map((s) => s.slice(4));
  }

  /**
   * SAN policy (spec §4): apex always hard-required. The wildcard is
   * hard-required only on the Cloudflare path (Origin Certs include it for
   * free and the wizard copy demands it); on proxy/none paths a missing
   * wildcard degrades preview subdomains, which the UI explains — so it is
   * reported, not enforced. Returns whether the wildcard is covered.
   */
  private checkSansCover(sans: string[], validatedDomain: string, servingMode: ProxyMode): boolean {
    const lowerSans = sans.map((s) => s.toLowerCase());
    if (!lowerSans.includes(validatedDomain)) {
      throw new BadRequestException(`Certificate does not cover ${validatedDomain}`);
    }
    const wildcardCovered = lowerSans.includes(`*.${validatedDomain}`);
    if (!wildcardCovered && servingMode === 'cloudflare') {
      throw new BadRequestException(
        `Certificate does not cover the wildcard *.${validatedDomain} — include it when creating the Origin Certificate`,
      );
    }
    return wildcardCovered;
  }

  /**
   * Re-validates that the staged generic cert (`fullchain.pem` — the file
   * nginx's apex/www/admin vhosts serve) actually covers `domain`, under the
   * same path-aware SAN policy as validateCertificatePair.
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
  assertStagedCertificateCovers(domain: string, servingMode: ProxyMode): void {
    const validatedDomain = this.assertValidDomain(domain);
    const stagedPath = path.join(sslStagingDir(), 'fullchain.pem');
    const certPath = fs.existsSync(stagedPath)
      ? stagedPath
      : path.join(this.sslDir(), 'fullchain.pem');
    let cert: X509Certificate;
    try {
      cert = new X509Certificate(fs.readFileSync(certPath));
    } catch {
      throw new BadRequestException(
        'Installed certificate could not be read — re-install the certificate for this domain',
      );
    }
    this.checkSansCover(this.dnsSans(cert), validatedDomain, servingMode);
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
    // A stage overwrites any prior stage — no accumulation. Without this, a
    // stale staged file from an earlier (possibly abandoned) stage can
    // survive alongside this upload's files, e.g. a stale wildcard.<domain>
    // pair from a paste sitting next to a freshly-issued LE pair — mixed
    // fullchain/privkey + wildcard.* material that promoteStagedCertificates
    // would then promote as if it were one coherent set.
    discardStagedCertificates();
    // #514: user-driven writes are provisional — they land in staging/ and
    // only apply() promotes them into the watched live dir.
    const dir = sslStagingDir();
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
    // Per-file union of staging and live: after #514 a stage may hold only
    // the generic pair (LE issuance with a real DNS-01 wildcard installed
    // live), and after a promote everything is live — both must count.
    const present = (name: string) =>
      fs.existsSync(path.join(sslStagingDir(), name)) ||
      fs.existsSync(path.join(this.sslDir(), name));
    return (
      present('fullchain.pem') &&
      present('privkey.pem') &&
      present(`wildcard.${validatedDomain}.crt`) &&
      present(`wildcard.${validatedDomain}.key`)
    );
  }

  private isValidCidr(range: string): boolean {
    const parts = range.split('/');
    if (parts.length !== 2) return false;
    const [addr, prefixStr] = parts;
    const family = isIP(addr);
    if (family === 0) return false;
    if (!/^\d{1,3}$/.test(prefixStr)) return false;
    const prefix = parseInt(prefixStr, 10);
    return prefix >= 0 && prefix <= (family === 4 ? 32 : 128);
  }

  /**
   * Combo validation + knob resolution for apply (spec §3). Every rule exists
   * to prevent a config that "works today, dies later" from ever being
   * written: a closed-port-80 LE install passes its first render but fails
   * its first renewal; a realIp trust list on a direct install lets any
   * client spoof X-Forwarded-For into rate limiting and logs.
   *
   * Header check deliberately reuses instance-config.ts's
   * SHELL_SAFE_HEADER_RE rather than the full RFC 9110 token charset: the
   * character set is deliberately narrower than RFC 9110's tchar grammar,
   * excluding characters that are shell-dangerous even inside a double-quoted
   * assignment — `$`, backtick, and the control operators `&` and `|` — even
   * though some are valid tchar characters. The header is written into a
   * double-quoted shell assignment (`REALIP_HEADER="..."`) in instance.env
   * (sourced by sh in the nginx container). Quoting alone stops most shell
   * interpolation, but `&` and `|` are control operators that can matter
   * outside a quoted context too, so SHELL_SAFE_HEADER_RE excludes them as a
   * second, independent layer — a DTO that accepted those characters would
   * otherwise only be caught at write time, deep inside a different layer.
   * Validating with the stricter, shell-safe set here means a rejection
   * always happens at the API boundary with this endpoint's own error
   * message.
   */
  validateApplyConfig(dto: ApplyBootstrapDto): AppliedConfig {
    if (dto.sslMode === 'letsencrypt') {
      // LE is HTTP-01, so it needs port 80 reachable — directly (proxyMode
      // 'none') or through a CDN that passes ACME challenges to the origin
      // (proxyMode 'proxy', e.g. Bunny). Not on Cloudflare, which terminates
      // TLS and expects its own Origin Certificate.
      if (dto.proxyMode !== 'none' && dto.proxyMode !== 'proxy') {
        throw new BadRequestException(
          'Let\'s Encrypt needs direct serving or a CDN that passes ACME through — not Cloudflare (use its Origin Certificate)',
        );
      }
      if (dto.port80 === 'closed') {
        throw new BadRequestException(
          'Port 80 must stay open (redirect) with Let\'s Encrypt — renewal uses HTTP-01 challenges',
        );
      }
    }
    if (dto.sslMode === 'selfsigned' && dto.proxyMode !== 'proxy') {
      // The box keeps serving its self-signed cert; only valid behind a proxy
      // that terminates browser TLS. A browser hitting a direct box, or
      // Cloudflare's Origin-Cert flow, would not accept it.
      throw new BadRequestException(
        'Keeping the self-signed certificate is only valid behind another CDN/WAF (proxyMode "proxy")',
      );
    }
    if (dto.port80 === 'closed' && dto.proxyMode === 'none') {
      throw new BadRequestException('Closing port 80 requires a proxy/CDN in front');
    }
    if (dto.realIp) {
      if (dto.proxyMode !== 'proxy') {
        throw new BadRequestException('Custom real-IP trust is only valid with proxyMode "proxy"');
      }
      if (!SHELL_SAFE_HEADER_RE.test(dto.realIp.header)) {
        throw new BadRequestException('Real-IP header must be a valid HTTP header name');
      }
      for (const range of dto.realIp.ranges) {
        if (!this.isValidCidr(range)) {
          throw new BadRequestException(`Invalid CIDR range: ${range}`);
        }
      }
    }

    // 'redirect' for every path, Cloudflare included: fresh CF zones ship
    // with Always Use HTTPS off, so a closed origin port 80 turns every
    // plain-http visitor into a CF 520 error page (v0.2.18 review, m13 —
    // observed through the live CF edge). Closing stays an explicit choice.
    const port80: Port80Mode = dto.port80 ?? 'redirect';
    const realIp: RealIpConfig =
      dto.proxyMode === 'cloudflare'
        ? { preset: 'cloudflare' }
        : dto.proxyMode === 'proxy' && dto.realIp
          ? { header: dto.realIp.header, ranges: dto.realIp.ranges }
          : null;
    return { proxyMode: dto.proxyMode, sslMode: dto.sslMode, port80, realIp };
  }
}
