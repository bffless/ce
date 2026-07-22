import { useSelector } from 'react-redux';
import { RootState } from '@/store';
import { PasteCertificateForm } from './PasteCertificateForm';
import { LetsEncryptForm } from './LetsEncryptForm';

interface CertificatePhaseProps {
  domain: string;
  onBack: () => void;
}

export function CertificatePhase({ domain, onBack }: CertificatePhaseProps) {
  const { servingMode, bootstrapSslMode } = useSelector((s: RootState) => s.setup.wizard);

  if (servingMode === 'none' && bootstrapSslMode === 'letsencrypt') {
    return <LetsEncryptForm domain={domain} onBack={onBack} />;
  }
  return <PasteCertificateForm domain={domain} onBack={onBack} />;
}
