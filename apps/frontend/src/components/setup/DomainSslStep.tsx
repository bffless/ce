import { useState } from 'react';
import { useDispatch } from 'react-redux';
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

export function DomainSslStep() {
  const dispatch = useDispatch();
  const [domain, setDomain] = useState(() => guessDomain());
  const [certificatePem, setCertificatePem] = useState('');
  const [privateKeyPem, setPrivateKeyPem] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [uploadCertificates, { isLoading }] = useUploadCertificatesMutation();

  const canSubmit = Boolean(domain.trim() && certificatePem.trim() && privateKeyPem.trim());

  const handleSubmit = async () => {
    if (!canSubmit || isLoading) return;
    setError(null);
    try {
      await uploadCertificates({ domain, certificatePem, privateKeyPem }).unwrap();
      dispatch(setBootstrapDomain(domain));
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
