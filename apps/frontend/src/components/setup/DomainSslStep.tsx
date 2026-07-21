import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '@/store';
import { useUploadCertificatesMutation } from '@/services/setupApi';
import { setBootstrapDomain, nextWizardStep, prevWizardStep } from '@/store/slices/setupSlice';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { XCircle, Loader2 } from 'lucide-react';

// Pre-fill the domain from where the admin panel is being served, e.g. a
// wizard reached via https://admin.example.com pre-fills "example.com". Bare
// IPs and localhost carry no usable domain, so leave the field empty for the
// user to type one in.
function guessDomain(): string {
  const hostname = window.location.hostname;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname === 'localhost') {
    return '';
  }
  return hostname.replace(/^(admin|www)\./, '');
}

// When the wizard is reached over a bare IP (the DigitalOcean / non-Cloudflare
// path), that IP is exactly what the user must point their A records at, so
// surface it. On the domain-first path the hostname is the domain (DNS is
// already set), so there's nothing useful to show and we fall back to generic
// wording. We can't ask the backend for its public IP here: getPlatformIp()
// resolves PRIMARY_DOMAIN via DNS, which is the very thing that doesn't resolve
// yet in bootstrap mode.
function serverIpHint(): string | null {
  const hostname = window.location.hostname;
  return /^\d+\.\d+\.\d+\.\d+$/.test(hostname) ? hostname : null;
}

export function DomainSslStep() {
  const dispatch = useDispatch();
  // The setup wizard is session-less; cert upload is gated by the claim token
  // collected at the claim step (or relayed via ?token=). Undefined on
  // LAN/Umbrel profiles with no token, where the backend check is open.
  const claimToken = useSelector((s: RootState) => s.setup.wizard.claimToken);
  const serverIp = serverIpHint();
  const [domain, setDomain] = useState(() => guessDomain());
  const [certificatePem, setCertificatePem] = useState('');
  const [privateKeyPem, setPrivateKeyPem] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [uploadCertificates, { isLoading }] = useUploadCertificatesMutation();

  const canSubmit = Boolean(domain.trim() && certificatePem.trim() && privateKeyPem.trim());

  const handleSubmit = async () => {
    if (!canSubmit || isLoading) return;
    setError(null);
    // Trim before submit: an untrimmed trailing/leading space passes
    // `canSubmit`'s truthiness check but fails the backend's hostname regex,
    // surfacing as an opaque "Invalid domain name" 400.
    const trimmedDomain = domain.trim();
    try {
      await uploadCertificates({
        domain: trimmedDomain,
        certificatePem,
        privateKeyPem,
        token: claimToken ?? undefined,
      }).unwrap();
      dispatch(setBootstrapDomain(trimmedDomain));
      dispatch(nextWizardStep());
    } catch (err: unknown) {
      const apiError = err as { data?: { message?: string } };
      setError(
        apiError?.data?.message ??
          'Certificate validation failed. Double-check the domain, certificate, and private key.'
      );
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-foreground">Domain &amp; SSL</h3>

        <div className="mt-3 rounded-md border border-border bg-muted/40 p-3">
          <p className="text-sm font-medium text-foreground">
            1. Point your domain at this server
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            At your DNS provider, create two <strong>A records</strong>
            {serverIp ? (
              <>
                {' '}
                pointing to this server&apos;s IP{' '}
                <code className="bg-muted px-1 rounded">{serverIp}</code>:
              </>
            ) : (
              <> pointing to this server&apos;s public IP address:</>
            )}
          </p>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            <li>
              <code className="bg-muted px-1 rounded">@</code> (apex, e.g.{' '}
              <code className="bg-muted px-1 rounded">yourdomain.com</code>)
            </li>
            <li>
              <code className="bg-muted px-1 rounded">*</code> (wildcard) — this is what makes{' '}
              <code className="bg-muted px-1 rounded">admin.</code>,{' '}
              <code className="bg-muted px-1 rounded">www.</code> and preview subdomains resolve
            </li>
          </ul>
          <p className="mt-2 text-sm text-muted-foreground">
            On <strong>Cloudflare</strong>, set both records to <strong>Proxied</strong> (orange
            cloud). Do this <strong>before you finish</strong> — the last step redirects to{' '}
            <code className="bg-muted px-1 rounded">admin.yourdomain</code>, which only works once
            DNS resolves.
          </p>
        </div>

        <p className="mt-3 text-sm font-medium text-foreground">2. Provide your certificate</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Paste a <strong>Cloudflare Origin Certificate</strong> for your domain. In the
          Cloudflare dashboard, go to{' '}
          <strong>SSL/TLS → Origin Server → Create Certificate</strong>, and make sure to include{' '}
          <code className="bg-muted px-1 rounded">*.yourdomain</code> alongside the apex domain in
          the certificate&apos;s hostnames.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Set your zone&apos;s SSL/TLS encryption mode to <strong>Full</strong> now. Once this
          wizard finishes, switch it to <strong>Full (strict)</strong>.
        </p>
      </div>

      <div>
        <Label htmlFor="bootstrap-domain">Domain</Label>
        <Input
          id="bootstrap-domain"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="example.com"
          className="mt-1"
          autoComplete="off"
        />
      </div>

      <div>
        <Label htmlFor="bootstrap-cert">Origin Certificate (PEM)</Label>
        <Textarea
          id="bootstrap-cert"
          value={certificatePem}
          onChange={(e) => setCertificatePem(e.target.value)}
          placeholder="-----BEGIN CERTIFICATE-----"
          rows={8}
          className="mt-1 font-mono text-xs"
        />
      </div>

      <div>
        <Label htmlFor="bootstrap-key">Private Key (PEM)</Label>
        <Textarea
          id="bootstrap-key"
          value={privateKeyPem}
          onChange={(e) => setPrivateKeyPem(e.target.value)}
          placeholder="-----BEGIN PRIVATE KEY-----"
          rows={8}
          className="mt-1 font-mono text-xs"
        />
      </div>

      {error && (
        <div className="flex items-center p-4 rounded-md bg-destructive/10 border border-destructive/20">
          <XCircle className="w-5 h-5 text-destructive mr-2 flex-shrink-0" />
          <span className="text-sm text-destructive">{error}</span>
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={() => dispatch(prevWizardStep())}>
          Back
        </Button>
        <Button onClick={handleSubmit} disabled={!canSubmit || isLoading}>
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Validating…
            </>
          ) : (
            'Install certificate'
          )}
        </Button>
      </div>
    </div>
  );
}
