import { useSelector } from 'react-redux';
import { RootState } from '@/store';
import { PasteCertificateForm } from './PasteCertificateForm';
import { LetsEncryptForm } from './LetsEncryptForm';
import { SelfSignedConfirm } from './SelfSignedConfirm';
import { ProxyOptions } from './ProxyOptions';

interface CertificatePhaseProps {
  domain: string;
  onBack: () => void;
}

export function CertificatePhase({ domain, onBack }: CertificatePhaseProps) {
  const { servingMode, bootstrapSslMode } = useSelector((s: RootState) => s.setup.wizard);

  const certView =
    bootstrapSslMode === 'selfsigned' ? (
      <SelfSignedConfirm domain={domain} onBack={onBack} />
    ) : bootstrapSslMode === 'letsencrypt' ? (
      <LetsEncryptForm domain={domain} onBack={onBack} />
    ) : (
      <PasteCertificateForm domain={domain} onBack={onBack} />
    );

  // The proxy path's real-IP / port-80 knobs apply to all three cert modes, so
  // they render above the cert-specific view (not inside the paste form).
  if (servingMode === 'proxy') {
    return (
      <div className="space-y-6">
        <ProxyOptions />
        {certView}
      </div>
    );
  }
  // Cloudflare: port 80 is a real choice (redirect default per m13); realIp
  // is preset server-side so only the port control shows.
  if (servingMode === 'cloudflare') {
    return (
      <div className="space-y-6">
        <ProxyOptions showRealIp={false} />
        {certView}
      </div>
    );
  }
  return certView;
}
