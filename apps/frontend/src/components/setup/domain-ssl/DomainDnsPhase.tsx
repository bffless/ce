import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '@/store';
import { useDnsPreflightMutation, DnsPreflightResponse } from '@/services/setupApi';
import { setDnsPreflightPassed } from '@/store/slices/setupSlice';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';

interface Props {
  domain: string;
  setDomain: (d: string) => void;
  serverIp: string | null;
  onBack: () => void;
  onNext: () => void;
}

export function DomainDnsPhase({ domain, setDomain, serverIp, onBack, onNext }: Props) {
  const dispatch = useDispatch();
  const { servingMode, bootstrapSslMode, claimToken, dnsPreflightPassed } = useSelector(
    (s: RootState) => s.setup.wizard,
  );
  const isLetsEncrypt = servingMode === 'none' && bootstrapSslMode === 'letsencrypt';
  const [preflight, { isLoading: checking }] = useDnsPreflightMutation();
  const [result, setResult] = useState<DnsPreflightResponse | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);

  const runCheck = async () => {
    setCheckError(null);
    try {
      const res = await preflight({ domain: domain.trim(), token: claimToken ?? undefined }).unwrap();
      setResult(res);
      dispatch(setDnsPreflightPassed(res.ok));
    } catch (err: unknown) {
      const apiError = err as { data?: { message?: string } };
      setCheckError(apiError?.data?.message ?? 'Check failed — is the domain spelled correctly?');
    }
  };

  const ipText = serverIp ?? "this server's public IP";
  const canNext = domain.trim().length > 0 && (!isLetsEncrypt || dnsPreflightPassed);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-foreground">Point your domain at {servingMode === 'none' ? 'this server' : 'your proxy'}</h3>
        {servingMode === 'cloudflare' && (
          <p className="mt-2 text-sm text-muted-foreground">
            In Cloudflare DNS, create two <strong>A records</strong> — <code className="bg-muted px-1 rounded">@</code> and{' '}
            <code className="bg-muted px-1 rounded">*</code> — pointing at <code className="bg-muted px-1 rounded">{ipText}</code>,
            both set to <strong>Proxied</strong> (orange cloud). Set the zone&apos;s SSL/TLS mode to{' '}
            <strong>Full</strong> now; the wizard reminds you to switch to <strong>Full (strict)</strong> at the end.
          </p>
        )}
        {servingMode === 'proxy' && (
          <p className="mt-2 text-sm text-muted-foreground">
            Point your apex domain and wildcard at your CDN/WAF following its docs, and set{' '}
            <code className="bg-muted px-1 rounded">{ipText}</code> as its <strong>origin</strong>. Preview subdomains
            need the wildcard routed too.
          </p>
        )}
        {servingMode === 'none' && (
          <p className="mt-2 text-sm text-muted-foreground">
            At your DNS provider, create two <strong>A records</strong> — <code className="bg-muted px-1 rounded">@</code>{' '}
            and <code className="bg-muted px-1 rounded">*</code> (wildcard: makes <code className="bg-muted px-1 rounded">admin.</code>,{' '}
            <code className="bg-muted px-1 rounded">www.</code> and previews resolve) — pointing at{' '}
            <code className="bg-muted px-1 rounded">{ipText}</code>. If your DNS host can proxy traffic (e.g.
            Cloudflare), turn that <strong>off</strong> for these records (gray cloud).
          </p>
        )}
      </div>

      <div>
        <Label htmlFor="bootstrap-domain">Domain</Label>
        <Input
          id="bootstrap-domain"
          value={domain}
          onChange={(e) => { setDomain(e.target.value); setResult(null); dispatch(setDnsPreflightPassed(false)); }}
          placeholder="example.com"
          className="mt-1"
          autoComplete="off"
        />
      </div>

      {isLetsEncrypt && (
        <div className="rounded-md border border-border bg-muted/40 p-4 space-y-3">
          <p className="text-sm font-medium text-foreground">
            DNS check <span className="font-normal text-muted-foreground">— required before a certificate can be issued</span>
          </p>
          {result?.checks.map((c) => (
            <div key={c.host} className="flex items-start text-sm">
              {c.probeOk ? (
                <CheckCircle2 className="w-4 h-4 mt-0.5 mr-2 text-green-600 flex-shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 mt-0.5 mr-2 text-destructive flex-shrink-0" />
              )}
              <span>
                <code className="bg-muted px-1 rounded">{c.host}</code>{' '}
                {c.probeOk
                  ? <>→ {c.resolvedIps.join(', ') || 'reachable'}</>
                  : <span className="text-muted-foreground">{c.error ?? 'not reachable yet'}{c.resolvedIps.length > 0 && <> (resolves to {c.resolvedIps.join(', ')})</>}</span>}
              </span>
            </div>
          ))}
          {checkError && <p className="text-sm text-destructive">{checkError}</p>}
          {result && !result.ok && (
            <p className="text-sm text-muted-foreground">
              DNS changes can take a few minutes to propagate — check again shortly.
            </p>
          )}
          <Button variant="outline" size="sm" onClick={runCheck} disabled={checking || !domain.trim()}>
            {checking ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" />Checking…</>) : result ? 'Check again' : 'Check DNS'}
          </Button>
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>Back</Button>
        <Button onClick={onNext} disabled={!canNext}>Next</Button>
      </div>
    </div>
  );
}
