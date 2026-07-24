import { useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '@/store';
import { useApplyBootstrapMutation } from '@/services/setupApi';
import { ServingMode, BootstrapSslMode } from '@/store/slices/setupSlice';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

// Poll cadence and the delay after which we admit the auto-redirect may
// never fire (e.g. the page is on a bare IP, cross-origin to adminUrl, and
// the backend's CORS allowlist — deliberately narrow — blocks every poll).
// The hint timer is driven by counting poll ticks rather than a second
// setTimeout, so a single fake-timer advance in tests exercises both.
const POLL_INTERVAL_MS = 3000;
const HINT_DELAY_MS = 30000;

const SERVING_LABELS: Record<ServingMode, string> = {
  cloudflare: 'Through Cloudflare',
  proxy: 'Through another CDN or WAF',
  none: 'Directly (A record to this server)',
};

const SSL_LABELS: Record<BootstrapSslMode, string> = {
  paste: 'Pasted certificate',
  letsencrypt: "Let's Encrypt (auto-renews)",
  selfsigned: 'Built-in certificate (self-signed)',
};

export function ApplyStep() {
  const domain = useSelector((s: RootState) => s.setup.wizard.bootstrapDomain);
  // Session-less wizard: apply is gated by the claim token, same as cert upload.
  const claimToken = useSelector((s: RootState) => s.setup.wizard.claimToken);
  // The serving choice was made up front in DomainSslStep — this step only
  // summarizes it and applies it, it no longer offers a proxyMode radio.
  const servingMode = useSelector((s: RootState) => s.setup.wizard.servingMode);
  const bootstrapSslMode = useSelector((s: RootState) => s.setup.wizard.bootstrapSslMode);
  const bootstrapPort80 = useSelector((s: RootState) => s.setup.wizard.bootstrapPort80);
  const bootstrapRealIp = useSelector((s: RootState) => s.setup.wizard.bootstrapRealIp);
  const dnsPreflightPassed = useSelector((s: RootState) => s.setup.wizard.dnsPreflightPassed);
  const wildcardIssued = useSelector((s: RootState) => s.setup.wizard.wildcardIssued);

  const [apply, { isLoading }] = useApplyBootstrapMutation();
  const [adminUrl, setAdminUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHint, setShowHint] = useState(false);

  const sslMode: BootstrapSslMode = bootstrapSslMode ?? 'paste';
  const isLetsEncrypt = sslMode === 'letsencrypt';
  // Port 80 handling, resolved the same way bootstrap-setup.service's
  // validateApplyConfig defaults it server-side: closed for cloudflare
  // (nothing needs it — the ACME challenge, if any, is served through the
  // proxy), open/redirect otherwise (proxy/none both need it reachable, the
  // latter for Let's Encrypt HTTP-01 renewal).
  const resolvedPort80 = bootstrapPort80 ?? (servingMode === 'cloudflare' ? 'closed' : 'redirect');
  // Visitor-IP restore: cloudflare always trusts Cloudflare's ranges (preset,
  // no user input needed), proxy mode only restores it when a custom
  // header/ranges were configured, and direct serving has nothing in front
  // to restore from.
  const realIpOn = servingMode === 'cloudflare' || (servingMode === 'proxy' && !!bootstrapRealIp);

  // Require an explicit "DNS is already pointed at this server" confirmation
  // before applying — UNLESS the Let's Encrypt path already proved it via
  // the DNS preflight check earlier in the wizard, in which case asking
  // again is redundant. If a user applies BEFORE DNS is live, the post-apply
  // redirect to admin.<domain> fails to resolve — and the browser caches
  // that NXDOMAIN, so even adding the records afterwards leaves them stuck
  // until a DNS-cache flush. Gating apply on this prevents the trap.
  const [dnsConfirmed, setDnsConfirmed] = useState(isLetsEncrypt && dnsPreflightPassed);
  // No initial value for setInterval's return type: the project's TS
  // strictness rejects useRef<T>() with zero args as "expected 1 argument",
  // so seed it with null and widen the ref type to allow that.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Guards against a slow in-flight poll and a later tick both resolving:
  // only the first to see doneRef === false may redirect.
  const doneRef = useRef(false);

  useEffect(() => {
    if (!adminUrl) return;
    doneRef.current = false;
    setShowHint(false);
    let elapsedMs = 0;
    pollRef.current = setInterval(async () => {
      if (doneRef.current) return;
      try {
        // Readiness probe. Reachability alone is a FALSE signal here: nginx
        // (separate container) never goes down during the apply restart and
        // answers 502 while the backend is dead — and an opaque no-cors fetch
        // resolves on that 502, which used to redirect ~17s early into an
        // "invalid credentials" login. /api/setup/ready replies with
        // Access-Control-Allow-Origin: *, so this plain fetch is readable
        // from ANY origin (bare-IP page included) and res.ok only goes true
        // once the backend is genuinely up (Nest listens only after full
        // bootstrap, so login works). While it isn't: cross-origin the 502
        // lacks the ACAO header and the fetch throws; same-origin it reads
        // as !ok. Either way we keep polling.
        const res = await fetch(`${adminUrl}/api/setup/ready`);
        if (res.ok) {
          if (doneRef.current) return;
          doneRef.current = true;
          if (pollRef.current) clearInterval(pollRef.current);
          window.location.href = adminUrl;
          return;
        }
      } catch {
        /* backend still restarting / DNS still propagating — keep polling */
      }
      elapsedMs += POLL_INTERVAL_MS;
      if (!doneRef.current && elapsedMs >= HINT_DELAY_MS) {
        setShowHint(true);
      }
    }, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [adminUrl]);

  const finish = async () => {
    if (!domain || !servingMode) return;
    setError(null);
    try {
      const res = await apply({
        domain,
        proxyMode: servingMode,
        sslMode: bootstrapSslMode ?? 'paste',
        port80: bootstrapPort80 ?? undefined,
        realIp: bootstrapRealIp ?? undefined,
        token: claimToken ?? undefined,
      }).unwrap();
      setAdminUrl(res.adminUrl);
    } catch (err: unknown) {
      const apiError = err as { data?: { message?: string } };
      setError(apiError?.data?.message ?? 'Apply failed');
    }
  };

  if (adminUrl) {
    return (
      <div className="space-y-4 text-center">
        <h3 className="text-lg font-medium text-foreground">Switching to {adminUrl}…</h3>
        <p className="text-sm text-muted-foreground">
          The server is restarting under its new identity. This page will redirect automatically
          once it comes back up.
        </p>
        <p className="text-sm">
          <a href={adminUrl} className="font-medium text-primary underline underline-offset-2">
            Open {adminUrl}
          </a>
        </p>
        {showHint && (
          <p className="text-sm text-muted-foreground">
            This is taking longer than expected. Make sure your domain&apos;s DNS points to this
            server — an <strong>A record</strong> for <code className="bg-muted px-1 rounded">@</code>{' '}
            and <code className="bg-muted px-1 rounded">*</code> (wildcard) at your server&apos;s IP.
            DNS may still be propagating — use the link above to continue manually.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-foreground">Finish setup</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          This applies <strong>{domain}</strong> as the server&apos;s domain, switches nginx to
          your new certificate, and restarts the backend under its new identity.
        </p>
      </div>

      <div className="space-y-2 p-4 border border-border rounded-lg bg-muted/30">
        <p className="text-sm">
          <span className="font-medium">Serving: </span>
          {servingMode ? SERVING_LABELS[servingMode] : 'Not set'}
        </p>
        <p className="text-sm">
          <span className="font-medium">Certificate: </span>
          {SSL_LABELS[sslMode]}
        </p>
        <p className="text-sm">
          <span className="font-medium">Port 80: </span>
          {resolvedPort80 === 'closed' ? 'Closed' : 'Open (redirects to HTTPS)'}
        </p>
        <p className="text-sm">
          <span className="font-medium">Visitor IP restore: </span>
          {realIpOn ? 'On' : 'Off'}
        </p>
        {isLetsEncrypt && (
          <p className="text-sm">
            <span className="font-medium">Wildcard: </span>
            {wildcardIssued ? 'issued ✓' : 'skipped (previews will warn)'}
          </p>
        )}
      </div>

      {isLetsEncrypt && dnsPreflightPassed ? (
        <div className="flex items-start p-4 border border-border rounded-lg">
          <span className="font-medium text-foreground">
            DNS was verified during the DNS check ✓
          </span>
        </div>
      ) : (
        <label className="flex items-start p-4 border border-border rounded-lg cursor-pointer hover:bg-muted/50">
          <input
            type="checkbox"
            checked={dnsConfirmed}
            onChange={(e) => setDnsConfirmed(e.target.checked)}
            disabled={isLoading}
            className="mt-1 mr-3"
          />
          <div className="flex-1">
            <span className="font-medium">
              I&apos;ve pointed <code className="bg-muted px-1 rounded">{domain || 'my domain'}</code>{' '}
              at this server
            </span>
            <p className="mt-1 text-sm text-muted-foreground">
              A records for <code className="bg-muted px-1 rounded">@</code> and{' '}
              <code className="bg-muted px-1 rounded">*</code> already resolve to this server. Applying
              before DNS is live leaves your browser stuck on a cached lookup for{' '}
              <code className="bg-muted px-1 rounded">admin.{domain || 'yourdomain'}</code>.
            </p>
          </div>
        </label>
      )}

      {error && (
        <div className="flex items-center p-4 rounded-md bg-destructive/10 border border-destructive/20">
          <span className="text-sm text-destructive">{error}</span>
        </div>
      )}

      <Button
        className="w-full"
        disabled={!domain || !servingMode || !dnsConfirmed || isLoading}
        onClick={finish}
      >
        {isLoading ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Applying…
          </>
        ) : (
          'Finish setup'
        )}
      </Button>
    </div>
  );
}
