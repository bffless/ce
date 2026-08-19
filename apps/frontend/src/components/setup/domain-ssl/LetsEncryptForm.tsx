import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '@/store';
import {
  useIssueCertificateMutation,
  useStartWildcardMutation,
  useCompleteWildcardMutation,
} from '@/services/setupApi';
import { setBootstrapDomain, setWildcardIssued, nextWizardStep } from '@/store/slices/setupSlice';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Loader2 } from 'lucide-react';

interface Props {
  domain: string;
  onBack: () => void;
}

// idle -> issuing -> issued, then optionally:
// offering -> starting -> started (records shown) -> verifying -> done | back to started (retryable failure)
type WildcardStage = 'offering' | 'starting' | 'started' | 'verifying';

interface WildcardRecord {
  recordName: string;
  recordValues: string[];
}

export function LetsEncryptForm({ domain, onBack }: Props) {
  const dispatch = useDispatch();
  const claimToken = useSelector((s: RootState) => s.setup.wizard.claimToken);

  const [issueCertificate, { isLoading: issuing }] = useIssueCertificateMutation();
  const [startWildcard, { isLoading: startingMutation }] = useStartWildcardMutation();
  const [completeWildcard, { isLoading: verifyingMutation }] = useCompleteWildcardMutation();

  const [issued, setIssued] = useState(false);
  const [sans, setSans] = useState<string[]>([]);
  const [issueError, setIssueError] = useState<string | null>(null);

  const [wildcardStage, setWildcardStage] = useState<WildcardStage | null>(null);
  const [wildcardRecord, setWildcardRecord] = useState<WildcardRecord | null>(null);
  const [wildcardError, setWildcardError] = useState<string | null>(null);

  // The Host/Name field on most DNS UIs wants only the label before the base
  // domain (they append the domain themselves), e.g. "_acme-challenge" rather
  // than the full "_acme-challenge.example.com".
  const suffix = `.${domain}`;
  const wildcardHost = wildcardRecord?.recordName.endsWith(suffix)
    ? wildcardRecord.recordName.slice(0, -suffix.length)
    : (wildcardRecord?.recordName ?? '');

  const finish = (wildcardIssued: boolean) => {
    dispatch(setBootstrapDomain(domain));
    dispatch(setWildcardIssued(wildcardIssued));
    dispatch(nextWizardStep());
  };

  const doIssue = async () => {
    setIssueError(null);
    try {
      const res = await issueCertificate({ domain, token: claimToken ?? undefined }).unwrap();
      setSans(res.sans);
      setIssued(true);
      setWildcardStage('offering');
    } catch (err: unknown) {
      const apiError = err as { data?: { message?: string } };
      setIssueError(
        apiError?.data?.message ?? 'Issuance failed — check DNS is still pointing at this server.',
      );
    }
  };

  const doStartWildcard = async () => {
    setWildcardError(null);
    setWildcardStage('starting');
    try {
      const res = await startWildcard({ domain, token: claimToken ?? undefined }).unwrap();
      setWildcardRecord({ recordName: res.recordName, recordValues: res.recordValues });
      setWildcardStage('started');
    } catch (err: unknown) {
      const apiError = err as { data?: { message?: string } };
      setWildcardError(apiError?.data?.message ?? 'Could not start wildcard issuance — try again.');
      setWildcardStage('offering');
    }
  };

  const doVerify = async () => {
    setWildcardError(null);
    setWildcardStage('verifying');
    try {
      await completeWildcard({ domain, token: claimToken ?? undefined }).unwrap();
      finish(true);
    } catch (err: unknown) {
      const apiError = err as { data?: { message?: string } };
      setWildcardError(
        apiError?.data?.message ?? 'Verification failed — DNS may not have propagated yet.',
      );
      // Retryable: keep the TXT records on screen so the user can just hit verify again.
      setWildcardStage('started');
    }
  };

  const skip = () => finish(false);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-foreground">
          Issue a Let&apos;s Encrypt certificate
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Issued right here for <code className="bg-muted px-1 rounded">{domain}</code>,{' '}
          <code className="bg-muted px-1 rounded">www.{domain}</code> and{' '}
          <code className="bg-muted px-1 rounded">admin.{domain}</code>, and renewed automatically.
        </p>
      </div>

      {!issued && (
        <>
          {issueError && <p className="text-sm text-destructive">{issueError}</p>}
          <div className="flex justify-between">
            <Button variant="outline" onClick={onBack}>
              Back
            </Button>
            <Button onClick={doIssue} disabled={issuing}>
              {issuing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Issuing…
                </>
              ) : (
                'Issue certificate'
              )}
            </Button>
          </div>
        </>
      )}

      {issued && (
        <div className="space-y-4">
          <p className="flex items-center text-sm font-medium text-foreground">
            <CheckCircle2 className="w-4 h-4 mr-2 text-green-600 flex-shrink-0" />
            Certificate issued for {sans.join(', ')}
          </p>

          {wildcardStage === 'offering' && (
            <div className="rounded-md border border-border p-4 space-y-3">
              <p className="text-sm text-foreground">
                Add a wildcard certificate so preview subdomains (e.g.{' '}
                <code className="bg-muted px-1 rounded">pr-42.{domain}</code>) don&apos;t show a
                certificate warning?
              </p>
              <p className="text-sm text-muted-foreground">
                Renews manually every ~90 days — we&apos;ll warn you in the admin panel and by email
                before it expires.
              </p>
              {wildcardError && <p className="text-sm text-destructive">{wildcardError}</p>}
              <div className="flex gap-2">
                <Button variant="outline" onClick={skip}>
                  Skip for now
                </Button>
                <Button onClick={doStartWildcard} disabled={startingMutation}>
                  {startingMutation ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Starting…
                    </>
                  ) : (
                    'Add a wildcard'
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Preview subdomains will show a certificate warning. You can add a wildcard later in
                Settings → SSL.
              </p>
            </div>
          )}

          {(wildcardStage === 'started' || wildcardStage === 'verifying') && wildcardRecord && (
            <div className="rounded-md border border-border p-4 space-y-3">
              <p className="text-sm text-foreground">
                Create this <strong>TXT</strong> record at your DNS provider:
              </p>
              <div className="rounded border border-border divide-y divide-border text-sm">
                <div className="p-2 space-y-0.5">
                  <div className="text-xs font-medium text-muted-foreground">Type</div>
                  <div className="font-mono">TXT</div>
                </div>
                <div className="p-2 space-y-0.5">
                  <div className="text-xs font-medium text-muted-foreground">Name / Host</div>
                  <div className="font-mono break-all">{wildcardRecord.recordName}</div>
                  <p className="text-xs text-muted-foreground">
                    Many providers (Namecheap, GoDaddy, Cloudflare) add your domain automatically —
                    there, enter just{' '}
                    <code className="bg-background px-1 rounded">{wildcardHost}</code> in the Host
                    field.
                  </p>
                </div>
                <div className="p-2 space-y-0.5">
                  <div className="text-xs font-medium text-muted-foreground">Value</div>
                  {wildcardRecord.recordValues.map((v) => (
                    <div key={v} className="font-mono break-all">
                      {v}
                    </div>
                  ))}
                </div>
              </div>
              {wildcardError && <p className="text-sm text-destructive">{wildcardError}</p>}
              <div className="flex gap-2">
                <Button variant="outline" onClick={skip}>
                  Skip for now
                </Button>
                <Button onClick={doVerify} disabled={verifyingMutation}>
                  {verifyingMutation ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Verifying…
                    </>
                  ) : (
                    "I've added the records — verify"
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
