import { useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '@/store';
import { useApplyBootstrapMutation } from '@/services/setupApi';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

// Poll cadence and the delay after which we admit the auto-redirect may
// never fire (e.g. the page is on a bare IP, cross-origin to adminUrl, and
// the backend's CORS allowlist — deliberately narrow — blocks every poll).
// The hint timer is driven by counting poll ticks rather than a second
// setTimeout, so a single fake-timer advance in tests exercises both.
const POLL_INTERVAL_MS = 3000;
const HINT_DELAY_MS = 30000;

export function ApplyStep() {
  const domain = useSelector((s: RootState) => s.setup.wizard.bootstrapDomain);
  const [apply, { isLoading }] = useApplyBootstrapMutation();
  const [adminUrl, setAdminUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHint, setShowHint] = useState(false);
  // Cloudflare is the recommended default (matches DomainSslStep's Origin
  // Certificate copy), but a direct A-record install with a non-Cloudflare
  // cert needs 'none' — otherwise port 80 becomes `return 444` with no
  // ACME-challenge path, permanently breaking certificate renewal.
  const [proxyMode, setProxyMode] = useState<'cloudflare' | 'none'>('cloudflare');
  // Captured at apply time so the post-apply screen's Cloudflare-specific
  // hint reflects what was actually applied, not whatever the (now hidden)
  // radio selection happens to be.
  const [appliedProxyMode, setAppliedProxyMode] = useState<'cloudflare' | 'none' | null>(null);
  // No initial value for setInterval's return type: the project's TS
  // strictness rejects useRef<T>() with zero args as "expected 1 argument",
  // so seed it with null and widen the ref type to allow that.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Guards against a slow in-flight poll and a later tick both observing
  // res.ok: only the first to see doneRef === false may redirect.
  const doneRef = useRef(false);

  useEffect(() => {
    if (!adminUrl) return;
    doneRef.current = false;
    setShowHint(false);
    let elapsedMs = 0;
    pollRef.current = setInterval(async () => {
      if (doneRef.current) return;
      try {
        const res = await fetch(`${adminUrl}/api/setup/status`, { mode: 'cors' });
        if (doneRef.current) return;
        if (res.ok) {
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
    if (!domain) return;
    setError(null);
    try {
      const res = await apply({ domain, proxyMode }).unwrap();
      setAppliedProxyMode(proxyMode);
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
            This is taking longer than expected. DNS may still be propagating, or your browser
            may be blocking the automatic check — use the link above to continue manually.
          </p>
        )}
        {appliedProxyMode === 'cloudflare' && (
          <p className="text-sm text-muted-foreground">
            Last step afterwards: set your Cloudflare zone&apos;s SSL/TLS encryption mode to{' '}
            <strong>Full (strict)</strong> — your origin now has a trusted certificate.
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

      <div className="space-y-3">
        <label
          className={`flex items-start p-4 border rounded-lg cursor-pointer transition-colors ${
            proxyMode === 'cloudflare'
              ? 'border-primary bg-primary/5'
              : 'border-border hover:bg-muted/50'
          }`}
        >
          <input
            type="radio"
            name="proxyMode"
            value="cloudflare"
            checked={proxyMode === 'cloudflare'}
            onChange={() => setProxyMode('cloudflare')}
            disabled={isLoading}
            className="mt-1 mr-3"
          />
          <div className="flex-1">
            <span className="font-medium">Cloudflare (recommended)</span>
            <p className="mt-1 text-sm text-muted-foreground">
              Traffic is proxied through Cloudflare. Port 80 stays closed to direct connections
              and nginx trusts Cloudflare&apos;s IP ranges for the visitor&apos;s real IP.
            </p>
          </div>
        </label>

        <label
          className={`flex items-start p-4 border rounded-lg cursor-pointer transition-colors ${
            proxyMode === 'none' ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
          }`}
        >
          <input
            type="radio"
            name="proxyMode"
            value="none"
            checked={proxyMode === 'none'}
            onChange={() => setProxyMode('none')}
            disabled={isLoading}
            className="mt-1 mr-3"
          />
          <div className="flex-1">
            <span className="font-medium">Direct (no proxy)</span>
            <p className="mt-1 text-sm text-muted-foreground">
              Use this if your domain points directly at this server (a plain A record, not
              proxied through Cloudflare). Port 80 redirects to HTTPS and stays reachable for
              certificate renewal.
            </p>
          </div>
        </label>
      </div>

      {error && (
        <div className="flex items-center p-4 rounded-md bg-destructive/10 border border-destructive/20">
          <span className="text-sm text-destructive">{error}</span>
        </div>
      )}

      <Button className="w-full" disabled={!domain || isLoading} onClick={finish}>
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
