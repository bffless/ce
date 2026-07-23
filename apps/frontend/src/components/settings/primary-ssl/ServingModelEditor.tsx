import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ServingChoiceCards, type ServingMode } from '@/components/ssl-leaves/ServingChoiceCards';
import { Port80Choice } from '@/components/ssl-leaves/Port80Choice';
import { RealIpFields } from '@/components/ssl-leaves/RealIpFields';
import { PasteCertificateFields } from '@/components/ssl-leaves/PasteCertificateFields';
import {
  useStagePrimaryCertificateMutation,
  useIssuePrimaryLetsEncryptMutation,
  usePrimarySslPreflightMutation,
  type PreflightResult,
} from '@/services/primarySslApi';
import { useToast } from '@/hooks/use-toast';

export type SslMode = 'paste' | 'letsencrypt' | 'selfsigned';

export interface EditorState {
  servingMode: ServingMode;
  sslMode: SslMode;
  port80: 'closed' | 'redirect';
  realIp: { header: string; ranges: string } | null;
  certificatePem: string;
  privateKeyPem: string;
}

// Mirrors the setup wizard's setServingMode reducer (setupSlice.ts): the
// certificate source most likely to already be correct for that serving
// path, adjustable afterward.
function presetSslFor(mode: ServingMode): SslMode {
  if (mode === 'proxy') return 'selfsigned';
  if (mode === 'cloudflare') return 'paste';
  return 'letsencrypt';
}

function errorMessage(error: unknown, fallback: string): string {
  const err = error as { data?: { message?: string } };
  return err?.data?.message || fallback;
}

export function ServingModelEditor({
  value,
  onChange,
  onCertStaged,
}: {
  value: EditorState;
  onChange: (v: EditorState) => void;
  onCertStaged: () => void;
}) {
  const { toast } = useToast();
  const [stageCertificate, { isLoading: isStaging }] = useStagePrimaryCertificateMutation();
  const [issueLetsEncrypt, { isLoading: isIssuing }] = useIssuePrimaryLetsEncryptMutation();
  const [runPreflight, { isLoading: isPreflighting }] = usePrimarySslPreflightMutation();
  const [preflightResult, setPreflightResult] = useState<PreflightResult | null>(null);

  const handleStage = async () => {
    try {
      await stageCertificate({
        certificatePem: value.certificatePem,
        privateKeyPem: value.privateKeyPem,
        servingMode: value.servingMode,
      }).unwrap();
      toast({ title: 'Certificate staged', description: 'Ready to apply.' });
      onCertStaged();
    } catch (error: unknown) {
      toast({ title: 'Error', description: errorMessage(error, 'Failed to validate certificate'), variant: 'destructive' });
    }
  };

  const handlePreflight = async () => {
    try {
      const result = await runPreflight().unwrap();
      setPreflightResult(result);
    } catch (error: unknown) {
      toast({ title: 'Error', description: errorMessage(error, 'DNS preflight failed'), variant: 'destructive' });
    }
  };

  const handleIssue = async () => {
    try {
      await issueLetsEncrypt().unwrap();
      toast({ title: "Let's Encrypt issued", description: 'Certificate is ready to apply.' });
    } catch (error: unknown) {
      toast({ title: 'Error', description: errorMessage(error, "Failed to issue Let's Encrypt certificate"), variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6">
      <ServingChoiceCards
        value={value.servingMode}
        onChange={(mode) => {
          const sslMode = presetSslFor(mode);
          onChange({
            ...value,
            servingMode: mode,
            sslMode,
            // Let's Encrypt is HTTP-01 and needs port 80 open — mirrors the
            // setup wizard's ProxyOptions, which clears a stale 'closed'
            // pick the same way when the mode becomes letsencrypt.
            port80: sslMode === 'letsencrypt' ? 'redirect' : value.port80,
          });
        }}
      />

      {value.servingMode !== 'cloudflare' && (
        <div className="space-y-4 pl-1">
          {value.sslMode === 'letsencrypt' ? (
            <p className="text-sm text-muted-foreground">
              Port 80 stays open so Let&apos;s Encrypt can validate over HTTP-01.
            </p>
          ) : (
            <Port80Choice
              value={value.port80}
              onChange={(port80) => onChange({ ...value, port80 })}
            />
          )}
          <RealIpFields
            header={value.realIp?.header ?? ''}
            ranges={value.realIp?.ranges ?? ''}
            onChange={(realIp) => onChange({ ...value, realIp })}
          />
        </div>
      )}

      {value.sslMode === 'paste' && (
        <div className="space-y-4">
          <PasteCertificateFields
            certificatePem={value.certificatePem}
            privateKeyPem={value.privateKeyPem}
            onChange={(v) => onChange({ ...value, ...v })}
          />
          <Button onClick={handleStage} disabled={isStaging}>
            {isStaging ? 'Validating…' : 'Validate & stage'}
          </Button>
        </div>
      )}

      {value.sslMode === 'letsencrypt' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <Button variant="outline" onClick={handlePreflight} disabled={isPreflighting}>
              {isPreflighting ? 'Checking…' : 'Run DNS preflight'}
            </Button>
            <Button onClick={handleIssue} disabled={isIssuing}>
              {isIssuing ? 'Issuing…' : "Issue Let's Encrypt"}
            </Button>
          </div>
          {preflightResult && (
            <p className={`text-sm ${preflightResult.ok ? 'text-foreground' : 'text-destructive'}`}>
              {preflightResult.ok
                ? 'DNS preflight passed.'
                : `DNS preflight failed: ${preflightResult.checks.map((c) => c.host).join(', ')}`}
            </p>
          )}
        </div>
      )}

      {value.sslMode === 'selfsigned' && (
        <p className="text-sm text-muted-foreground">
          Keeping the built-in self-signed certificate — nothing to upload. Most CDNs and WAFs
          don&apos;t validate the origin certificate, so this is a fine default.
        </p>
      )}
    </div>
  );
}
