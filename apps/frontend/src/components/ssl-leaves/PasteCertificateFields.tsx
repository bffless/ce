import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export interface PasteCertificateFieldsValue {
  certificatePem: string;
  privateKeyPem: string;
}

export function PasteCertificateFields({
  certificatePem,
  privateKeyPem,
  onChange,
}: PasteCertificateFieldsValue & { onChange: (v: PasteCertificateFieldsValue) => void }) {
  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="cert-pem">Certificate (PEM)</Label>
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
