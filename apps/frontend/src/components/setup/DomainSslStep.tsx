import { useState } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '@/store';
import { ServingChoicePhase } from './domain-ssl/ServingChoicePhase';
import { DomainDnsPhase } from './domain-ssl/DomainDnsPhase';
import { CertificatePhase } from './domain-ssl/CertificatePhase';

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

type Phase = 'serving' | 'dns' | 'cert';

export function DomainSslStep() {
  const servingMode = useSelector((s: RootState) => s.setup.wizard.servingMode);
  const [phase, setPhase] = useState<Phase>(() => (servingMode ? 'dns' : 'serving'));
  const [domain, setDomain] = useState(() => guessDomain());
  const serverIp = serverIpHint();

  if (phase === 'serving') {
    return <ServingChoicePhase onNext={() => setPhase('dns')} />;
  }
  if (phase === 'dns') {
    return (
      <DomainDnsPhase
        domain={domain}
        setDomain={setDomain}
        serverIp={serverIp}
        onBack={() => setPhase('serving')}
        onNext={() => setPhase('cert')}
      />
    );
  }
  return <CertificatePhase domain={domain} onBack={() => setPhase('dns')} />;
}
