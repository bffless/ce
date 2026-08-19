import { useDispatch } from 'react-redux';
import { setBootstrapDomain, nextWizardStep } from '@/store/slices/setupSlice';
import { Button } from '@/components/ui/button';

export function SelfSignedConfirm({ domain, onBack }: { domain: string; onBack: () => void }) {
  const dispatch = useDispatch();
  const confirm = () => {
    dispatch(setBootstrapDomain(domain));
    dispatch(nextWizardStep());
  };
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-foreground">Keep the built-in certificate</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          This server will keep serving its built-in self-signed certificate. Your CDN terminates
          browser TLS in front of it, so visitors never see it — there&apos;s nothing to paste and
          nothing to renew. The link from your CDN to this server is encrypted but not
          authenticated; if you turn on your CDN&apos;s origin verification, go back and choose
          Let&apos;s Encrypt or paste a certificate.
        </p>
      </div>
      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={confirm}>Continue</Button>
      </div>
    </div>
  );
}
