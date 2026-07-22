import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '@/store';
import { useUploadCertificatesMutation } from '@/services/setupApi';
import {
  ServingMode,
  setBootstrapDomain,
  setBootstrapPort80,
  setBootstrapRealIp,
  nextWizardStep,
} from '@/store/slices/setupSlice';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2 } from 'lucide-react';
import { validateRealIp } from '@/lib/validateRealIp';

interface Props {
  domain: string;
  onBack: () => void;
}

// Copy varies by servingMode: the wording, worked example, and CA guidance
// only make sense relative to how traffic actually reaches this server.
const COPY: Record<ServingMode, { title: string; certLabel: string; body: JSX.Element }> = {
  cloudflare: {
    title: 'Provide your Cloudflare Origin Certificate',
    certLabel: 'Origin Certificate (PEM)',
    body: (
      <>
        Paste a <strong>Cloudflare Origin Certificate</strong> for your domain. In the Cloudflare
        dashboard: <strong>SSL/TLS → Origin Server → Create Certificate</strong>; include{' '}
        <code className="bg-muted px-1 rounded">*.yourdomain</code> alongside the apex. Keep the
        zone&apos;s SSL/TLS mode on <strong>Full</strong> until the wizard finishes.
      </>
    ),
  },
  proxy: {
    title: 'Provide your origin certificate',
    certLabel: 'Origin Certificate (PEM)',
    body: (
      <>
        Paste <strong>your CDN&apos;s origin certificate</strong> — issued from its dashboard for{' '}
        <code className="bg-muted px-1 rounded">yourdomain</code>, and ideally{' '}
        <code className="bg-muted px-1 rounded">*.yourdomain</code> so preview subdomains work.
        Your CDN must be configured to connect to this origin over HTTPS.
      </>
    ),
  },
  none: {
    title: 'Provide your certificate',
    certLabel: 'Certificate — full chain (PEM)',
    body: (
      <>
        Paste a <strong>browser-trusted certificate</strong> from any CA covering{' '}
        <code className="bg-muted px-1 rounded">yourdomain</code> (include{' '}
        <code className="bg-muted px-1 rounded">*.yourdomain</code> if you can). You&apos;ll
        re-paste here when you renew it.
      </>
    ),
  },
};

export function PasteCertificateForm({ domain, onBack }: Props) {
  const dispatch = useDispatch();
  const { servingMode, claimToken } = useSelector((s: RootState) => s.setup.wizard);
  const mode = servingMode ?? 'none';
  const copy = COPY[mode];

  const [certificatePem, setCertificatePem] = useState('');
  const [privateKeyPem, setPrivateKeyPem] = useState('');
  const [rangesText, setRangesText] = useState('');
  const [header, setHeader] = useState('');
  const [closePort80, setClosePort80] = useState(false);

  const [uploadCertificates, { isLoading }] = useUploadCertificatesMutation();
  const [error, setError] = useState<string | null>(null);
  const [wildcardWarning, setWildcardWarning] = useState(false);
  const [rangesError, setRangesError] = useState<string | null>(null);
  const [headerError, setHeaderError] = useState<string | null>(null);

  const finish = () => {
    dispatch(setBootstrapDomain(domain));
    dispatch(nextWizardStep());
  };

  const submit = async () => {
    setError(null);
    setRangesError(null);
    setHeaderError(null);

    // Proxy-only knobs must land in the store BEFORE (or alongside) the
    // upload call, so the later Apply step reads them back out. Validate
    // here first (mirroring the backend's validateApplyConfig rules) so a
    // bad CIDR or unsafe header is caught inline rather than surfacing as a
    // 400 at the final Apply step, which has no Back button.
    if (mode === 'proxy') {
      if (rangesText.trim()) {
        const result = validateRealIp(rangesText, header);
        if (result.rangesError || result.headerError) {
          setRangesError(result.rangesError);
          setHeaderError(result.headerError);
          return;
        }
        dispatch(setBootstrapRealIp({ header: result.header, ranges: result.ranges }));
      } else {
        dispatch(setBootstrapRealIp(null));
      }
      dispatch(setBootstrapPort80(closePort80 ? 'closed' : null));
    }

    try {
      const res = await uploadCertificates({
        domain,
        certificatePem,
        privateKeyPem,
        servingMode: mode,
        token: claimToken ?? undefined,
      }).unwrap();

      if (!res.wildcardCovered) {
        setWildcardWarning(true);
        return;
      }
      finish();
    } catch (err: unknown) {
      const apiError = err as { data?: { message?: string } };
      setError(apiError?.data?.message ?? 'Upload failed — check the certificate and key are valid PEM.');
    }
  };

  const canSubmit = certificatePem.trim().length > 0 && privateKeyPem.trim().length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-foreground">{copy.title}</h3>
        <p className="mt-2 text-sm text-muted-foreground">{copy.body}</p>
      </div>

      <div>
        <Label htmlFor="cert-pem">{copy.certLabel}</Label>
        <Textarea
          id="cert-pem"
          value={certificatePem}
          onChange={(e) => setCertificatePem(e.target.value)}
          placeholder="-----BEGIN CERTIFICATE-----"
          rows={6}
          className="mt-1 font-mono text-xs"
        />
      </div>
      <div>
        <Label htmlFor="key-pem">Private Key (PEM)</Label>
        <Textarea
          id="key-pem"
          value={privateKeyPem}
          onChange={(e) => setPrivateKeyPem(e.target.value)}
          placeholder="-----BEGIN PRIVATE KEY-----"
          rows={6}
          className="mt-1 font-mono text-xs"
        />
      </div>

      {mode === 'proxy' && (
        <details className="rounded-md border border-border p-3">
          <summary className="text-sm font-medium cursor-pointer">Restore visitor IPs (optional)</summary>
          <div className="mt-3 space-y-3">
            <p className="text-sm text-muted-foreground">
              Skip this and everything works — logs and rate limiting will just see your CDN&apos;s
              IPs instead of visitors&apos;. To restore real IPs, paste your CDN&apos;s egress
              ranges.
            </p>
            <div>
              <Label htmlFor="realip-ranges">Trusted ranges (CIDR, one per line)</Label>
              <Textarea
                id="realip-ranges"
                value={rangesText}
                onChange={(e) => {
                  setRangesText(e.target.value);
                  setRangesError(null);
                }}
                placeholder={'151.101.0.0/16\n2a04:4e40::/32'}
                rows={4}
                className="mt-1 font-mono text-xs"
                aria-invalid={rangesError ? true : undefined}
              />
              {rangesError && <p className="mt-1 text-sm text-destructive">{rangesError}</p>}
            </div>
            <div>
              <Label htmlFor="realip-header">Header carrying the visitor IP</Label>
              <Input
                id="realip-header"
                value={header}
                onChange={(e) => {
                  setHeader(e.target.value);
                  setHeaderError(null);
                }}
                placeholder="X-Forwarded-For"
                className="mt-1"
                aria-invalid={headerError ? true : undefined}
              />
              {headerError && <p className="mt-1 text-sm text-destructive">{headerError}</p>}
            </div>
          </div>
        </details>
      )}
      {mode === 'proxy' && (
        <label className="flex items-start text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={closePort80}
            onChange={(e) => setClosePort80(e.target.checked)}
            className="mt-0.5 mr-2"
          />
          <span>Close port 80 — my CDN connects to this origin over HTTPS only</span>
        </label>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {wildcardWarning && (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-4 space-y-3">
          <p className="text-sm text-foreground">
            This certificate doesn&apos;t cover a wildcard SAN. Preview subdomains will show a
            certificate warning until you add one — you can paste a wildcard-covering certificate
            later in Settings → SSL.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setWildcardWarning(false)}>
              Go back
            </Button>
            <Button onClick={finish}>Continue anyway</Button>
          </div>
        </div>
      )}

      {!wildcardWarning && (
        <div className="flex justify-between">
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
          <Button onClick={submit} disabled={!canSubmit || isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Uploading…
              </>
            ) : (
              'Upload certificate'
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
