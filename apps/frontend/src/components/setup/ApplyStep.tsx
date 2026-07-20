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
      const res = await apply({ domain, proxyMode: 'cloudflare' }).unwrap();
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
        <p className="text-sm text-muted-foreground">
          Last step afterwards: set your Cloudflare zone&apos;s SSL/TLS encryption mode to{' '}
          <strong>Full (strict)</strong> — your origin now has a trusted certificate.
        </p>
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
