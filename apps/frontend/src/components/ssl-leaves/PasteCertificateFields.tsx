import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export interface PasteCertificateFieldsValue {
  certificatePem: string;
  privateKeyPem: string;
}

export function PasteCertificateFields({
  certificatePem,
  privateKeyPem,
  certLabel = 'Certificate (PEM)',
  onChange,
}: PasteCertificateFieldsValue & {
  /** Cert-field label. Callers whose copy varies by serving mode (e.g. "Origin Certificate (PEM)") pass it in; defaults to the generic label. */
  certLabel?: string;
  onChange: (v: PasteCertificateFieldsValue) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="cert-pem">{certLabel}</Label>
        <Textarea
          id="cert-pem"
          value={certificatePem}
          onChange={(e) => onChange({ certificatePem: e.target.value, privateKeyPem })}
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
          onChange={(e) => onChange({ certificatePem, privateKeyPem: e.target.value })}
          placeholder="-----BEGIN PRIVATE KEY-----"
          rows={6}
          className="mt-1 font-mono text-xs"
        />
      </div>
    </div>
  );
}
