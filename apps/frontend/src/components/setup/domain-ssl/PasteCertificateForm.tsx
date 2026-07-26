import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '@/store';
import { useUploadCertificatesMutation } from '@/services/setupApi';
import {
  ServingMode,
  setBootstrapDomain,
  nextWizardStep,
} from '@/store/slices/setupSlice';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { PasteCertificateFields } from '@/components/ssl-leaves/PasteCertificateFields';
import { DOCS, VIDEOS } from '@/lib/docsLinks';
import { DocsLink, WatchLink } from '@/components/common/DocsLink';

interface Props {
  domain: string;
  onBack: () => void;
}

// Copy varies by servingMode: the wording, worked example, and CA guidance
// only make sense relative to how traffic actually reaches this server.
// docs/video are optional: only the Cloudflare path has a guide of ours to
// point at. A CDN's or a public CA's issuance flow is theirs to document, and
// omitting the fields keeps that decision visible next to the copy it applies to.
const COPY: Record<
  ServingMode,
  {
    title: string;
    certLabel: string;
    body: JSX.Element;
    docs?: { href: string; label: string };
    video?: { id: string; start: number };
  }
> = {
  cloudflare: {
    title: 'Provide your Cloudflare Origin Certificate',
    certLabel: 'Origin Certificate (PEM)',
    body: (
      <>
        Paste a <strong>Cloudflare Origin Certificate</strong> for your domain. In the Cloudflare
        dashboard: <strong>SSL/TLS → Origin Server → Create Certificate</strong>; include{' '}
        <code className="bg-muted px-1 rounded">*.yourdomain</code> alongside the apex. Then set the
        zone&apos;s SSL/TLS mode to <strong>Full (strict)</strong> — Cloudflare trusts this Origin
        Certificate, so strict validation works right away.
      </>
    ),
    docs: { href: DOCS.cloudflare.cert, label: 'Generating a Cloudflare Origin Certificate' },
    video: { id: VIDEOS.cloudflareSetup.id, start: VIDEOS.cloudflareSetup.certStart },
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

  const [uploadCertificates, { isLoading }] = useUploadCertificatesMutation();
  const [error, setError] = useState<string | null>(null);
  const [wildcardWarning, setWildcardWarning] = useState(false);

  const finish = () => {
    dispatch(setBootstrapDomain(domain));
    dispatch(nextWizardStep());
  };

  const submit = async () => {
    setError(null);

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
        {copy.docs && (
          <div className="mt-3">
            <DocsLink href={copy.docs.href} label={copy.docs.label} />
            {copy.video && <WatchLink videoId={copy.video.id} start={copy.video.start} />}
          </div>
        )}
      </div>

      <PasteCertificateFields
        certificatePem={certificatePem}
        privateKeyPem={privateKeyPem}
        certLabel={copy.certLabel}
        onChange={({ certificatePem, privateKeyPem }) => {
          setCertificatePem(certificatePem);
          setPrivateKeyPem(privateKeyPem);
        }}
      />

      {error && <p className="text-sm text-destructive">{error}</p>}

      {wildcardWarning && (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-4 space-y-3">
          <p className="text-sm text-foreground">
            This certificate doesn&apos;t cover a wildcard SAN. Preview subdomains will show a
            certificate warning until you add one — you can manage the primary certificate later
            under Admin → Settings → SSL.
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
