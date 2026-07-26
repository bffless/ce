import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ServingChoiceCards, type ServingMode } from '@/components/ssl-leaves/ServingChoiceCards';
import { Port80Choice } from '@/components/ssl-leaves/Port80Choice';
import { RealIpFields } from '@/components/ssl-leaves/RealIpFields';
import { PasteCertificateFields } from '@/components/ssl-leaves/PasteCertificateFields';
import { DOCS, VIDEOS } from '@/lib/docsLinks';
import { DocsInlineLink, WatchLink } from '@/components/common/DocsLink';
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

// Wizard-parity cert-source sets (mirrors the wizard's per-path choices:
// CertificatePhase + the proxy path's three modes). The wizard promises
// "change this later in Settings → SSL" — this selector is that promise
// (v0.2.18 review, m11).
export function allowedSslModesFor(mode: ServingMode): SslMode[] {
  if (mode === 'proxy') return ['selfsigned', 'letsencrypt', 'paste'];
  if (mode === 'cloudflare') return ['paste'];
  return ['letsencrypt', 'paste'];
}

const SSL_MODE_LABELS: Record<SslMode, { label: string; hint: string }> = {
  selfsigned: {
    label: 'Keep the built-in certificate',
    hint: 'Zero maintenance. Works with CDNs that don’t validate the origin certificate.',
  },
  letsencrypt: {
    label: "Auto-issue with Let's Encrypt",
    hint: 'A real auto-renewing certificate on this server. Needs ACME challenges to reach the origin.',
  },
  paste: {
    label: 'Paste my own certificate',
    hint: 'Your CDN’s origin certificate or any browser-trusted cert. Re-paste when it expires.',
  },
};

function errorMessage(error: unknown, fallback: string): string {
  const err = error as { data?: { message?: string } };
  return err?.data?.message || fallback;
}

export function ServingModelEditor({
  value,
  onChange,
  currentCertDaysLeft = null,
  isCurrentlyLetsEncrypt = false,
}: {
  value: EditorState;
  onChange: (v: EditorState) => void;
  /** Days left on the currently-served cert, when known (used to gate "Renew now"). */
  currentCertDaysLeft?: number | null;
  /** True when the LIVE status already reports sslMode === 'letsencrypt' (as opposed to the editor merely staging a switch to it). */
  isCurrentlyLetsEncrypt?: boolean;
}) {
  const { toast } = useToast();
  const [stageCertificate, { isLoading: isStaging }] = useStagePrimaryCertificateMutation();
  const [issueLetsEncrypt, { isLoading: isIssuing }] = useIssuePrimaryLetsEncryptMutation();
  const [runPreflight, { isLoading: isPreflighting }] = usePrimarySslPreflightMutation();
  const [preflightResult, setPreflightResult] = useState<PreflightResult | null>(null);

  // Reactively enforce the LE/port-80 invariant (fully mirrors the wizard's
  // ProxyOptions useEffect): Let's Encrypt is HTTP-01 and needs port 80 open,
  // so a stale/legacy EditorState seeded with letsencrypt + 'closed' (which the
  // Port80Choice control is hidden for, so the user couldn't fix it) is
  // corrected here rather than dead-ending on the backend's 400 at Apply.
  useEffect(() => {
    if (value.sslMode === 'letsencrypt' && value.port80 === 'closed') {
      onChange({ ...value, port80: 'redirect' });
    }
  }, [value.sslMode, value.port80]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStage = async () => {
    try {
      await stageCertificate({
        certificatePem: value.certificatePem,
        privateKeyPem: value.privateKeyPem,
        servingMode: value.servingMode,
      }).unwrap();
      toast({ title: 'Certificate staged', description: 'Ready to apply.' });
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
      const result = await issueLetsEncrypt().unwrap();
      if (result.reused) {
        toast({ title: 'Certificate already valid', description: "Nothing to renew — it renews automatically." });
      } else {
        toast({ title: 'New certificate issued', description: 'Certificate is ready to apply.' });
      }
    } catch (error: unknown) {
      toast({ title: 'Error', description: errorMessage(error, "Failed to issue Let's Encrypt certificate"), variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6">
      <ServingChoiceCards
        value={value.servingMode}
        onChange={(mode) => {
          // The preset still applies on every mode change (unchanged
          // behavior) — it's the best default for that serving path. The
          // cert-source selector below then lets the user adjust within the
          // newly-allowed set afterward (m11 wizard parity).
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

      {allowedSslModesFor(value.servingMode).length > 1 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">Certificate for the origin</p>
          {allowedSslModesFor(value.servingMode).map((mode) => (
            <label key={mode} className="flex items-start text-sm cursor-pointer">
              <input
                type="radio"
                name="day2-ssl-mode"
                checked={value.sslMode === mode}
                onChange={() =>
                  onChange({
                    ...value,
                    sslMode: mode,
                    // LE is HTTP-01: mirrors the wizard's ProxyOptions clearing
                    // of a stale 'closed' pick.
                    port80: mode === 'letsencrypt' ? 'redirect' : value.port80,
                  })
                }
                className="mt-0.5 mr-2"
                aria-label={SSL_MODE_LABELS[mode].label}
              />
              <span>
                <span className="font-medium">{SSL_MODE_LABELS[mode].label}</span>{' '}
                <span className="text-muted-foreground">{SSL_MODE_LABELS[mode].hint}</span>
              </span>
            </label>
          ))}
        </div>
      )}

      {value.servingMode !== 'cloudflare' ? (
        <div className="space-y-4 pl-1">
          {value.sslMode === 'letsencrypt' ? (
            <p className="text-sm text-muted-foreground">
              Port 80 stays open so Let&apos;s Encrypt can validate over HTTP-01.
            </p>
          ) : (
            <Port80Choice value={value.port80} onChange={(port80) => onChange({ ...value, port80 })} />
          )}
          <RealIpFields
            header={value.realIp?.header ?? ''}
            ranges={value.realIp?.ranges ?? ''}
            onChange={(realIp) => onChange({ ...value, realIp })}
          />
        </div>
      ) : (
        <div className="space-y-4 pl-1">
          <Port80Choice value={value.port80} onChange={(port80) => onChange({ ...value, port80 })} />
        </div>
      )}

      {value.sslMode === 'paste' && (
        <div className="space-y-4">
          {value.servingMode === 'cloudflare' && (
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>
                Need a certificate?{' '}
                <DocsInlineLink href={DOCS.cloudflare.cert}>
                  Generating a Cloudflare Origin Certificate
                </DocsInlineLink>
                {' · '}
                <DocsInlineLink href={DOCS.cloudflare.dns}>
                  Creating DNS records
                </DocsInlineLink>
              </p>
              <WatchLink
                videoId={VIDEOS.cloudflareSetup.id}
                start={VIDEOS.cloudflareSetup.certStart}
              />
            </div>
          )}
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

      {value.sslMode === 'letsencrypt' && isCurrentlyLetsEncrypt && (
        <div className="space-y-4">
          <p className="text-sm text-foreground">
            Let&apos;s Encrypt is active — covers your apex, www, and admin hostnames. Renews automatically.
            {typeof currentCertDaysLeft === 'number' && ` ${currentCertDaysLeft} days left.`}
          </p>
          <p className="text-sm text-muted-foreground">
            Wildcard (*.yourdomain) is issued separately via DNS-01 under Domains → SSL — this does not renew it.
          </p>
          <div className="flex gap-2 items-center">
            <Button
              variant="outline"
              onClick={handleIssue}
              disabled={isIssuing || (currentCertDaysLeft != null && currentCertDaysLeft > 30)}
            >
              {isIssuing ? 'Renewing…' : 'Renew now'}
            </Button>
            {currentCertDaysLeft != null && currentCertDaysLeft > 30 && (
              <p className="text-sm text-muted-foreground">Not due yet — renews automatically at 30 days.</p>
            )}
          </div>
        </div>
      )}

      {value.sslMode === 'letsencrypt' && !isCurrentlyLetsEncrypt && (
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
