import { useState } from 'react';
import {
  useGetWildcardCertificateStatusQuery,
  useGetPendingWildcardChallengeQuery,
  useRequestWildcardCertificateMutation,
  useVerifyWildcardCertificateMutation,
  useLazyCheckWildcardDnsPropagationQuery,
  useDeleteWildcardCertificateMutation,
  useCancelPendingWildcardChallengeMutation,
  useGetDomainsConfigQuery,
} from '@/services/domainsApi';
import { useFeatureFlags } from '@/services/featureFlagsApi';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  Copy,
  CheckCircle2,
  Clock,
  RefreshCw,
  AlertTriangle,
  Trash2,
  X,
  Info,
  Wrench,
} from 'lucide-react';

export function SslCertificatePanel() {
  const { toast } = useToast();
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  // Check if wildcard SSL feature is enabled
  const { isEnabled, isLoading: flagLoading } = useFeatureFlags();
  const isWildcardSslEnabled = isEnabled('ENABLE_WILDCARD_SSL');

  // Queries - skip if feature flag is loading or disabled
  const skipQueries = flagLoading || !isWildcardSslEnabled;

  const {
    data: certStatus,
    isLoading: statusLoading,
    refetch: refetchStatus,
  } = useGetWildcardCertificateStatusQuery(undefined, { skip: skipQueries });

  const {
    data: pendingChallenge,
    isLoading: challengeLoading,
    refetch: refetchChallenge,
  } = useGetPendingWildcardChallengeQuery(undefined, { skip: skipQueries });

  // Mutations
  const [requestCert, { isLoading: isRequesting }] = useRequestWildcardCertificateMutation();
  const [verifyCert, { isLoading: isVerifying }] = useVerifyWildcardCertificateMutation();
  const [deleteCert, { isLoading: isDeleting }] = useDeleteWildcardCertificateMutation();
  const [cancelChallenge, { isLoading: isCancelling }] = useCancelPendingWildcardChallengeMutation();

  // DNS check (lazy query - only runs when triggered)
  const [checkDns, { data: dnsStatus, isLoading: isCheckingDns }] =
    useLazyCheckWildcardDnsPropagationQuery();

  // Get domains config for base domain
  const { data: domainsConfig } = useGetDomainsConfigQuery();

  const handleRequestCertificate = async () => {
    try {
      await requestCert().unwrap();
      toast({
        title: 'Certificate request started',
        description: 'Add the DNS TXT record shown below to verify domain ownership.',
      });
      refetchChallenge();
    } catch (err: unknown) {
      const errorMessage =
        (err as { data?: { message?: string } })?.data?.message ||
        'Failed to request certificate. Make sure CERTBOT_EMAIL is configured.';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  const handleVerifyCertificate = async () => {
    try {
      const result = await verifyCert().unwrap();
      if (result.success) {
        toast({
          title: 'Certificate issued!',
          description: 'Wildcard SSL certificate has been successfully issued. All subdomains now support HTTPS.',
        });
        refetchStatus();
        refetchChallenge();
      } else {
        toast({
          title: 'Verification failed',
          description: result.message || 'DNS verification failed. Please check your TXT record.',
          variant: 'destructive',
        });
      }
    } catch (err: unknown) {
      const errorMessage =
        (err as { data?: { message?: string } })?.data?.message ||
        'Verification failed. Ensure the DNS TXT record has propagated.';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  const handleDeleteCertificate = async () => {
    try {
      await deleteCert().unwrap();
      toast({
        title: 'Certificate deleted',
        description: 'Wildcard SSL certificate has been removed. SSL is now disabled for all subdomains.',
      });
      setShowDeleteDialog(false);
      refetchStatus();
    } catch (err: unknown) {
      const errorMessage =
        (err as { data?: { message?: string } })?.data?.message ||
        'Failed to delete certificate.';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  const handleCancelChallenge = async () => {
    try {
      await cancelChallenge().unwrap();
      toast({
        title: 'Request cancelled',
        description: 'Pending certificate request has been cancelled.',
      });
      refetchChallenge();
    } catch (err: unknown) {
      const errorMessage =
        (err as { data?: { message?: string } })?.data?.message ||
        'Failed to cancel request.';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
    toast({
      title: 'Copied!',
      description: `${field} copied to clipboard`,
    });
  };

  const formatExpiryDate = (dateStr?: string) => {
    if (!dateStr) return 'Unknown';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  // Show loading while checking feature flag
  if (flagLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64 mt-2" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  // Don't render anything if wildcard SSL is disabled (PaaS handles SSL at edge)
  if (!isWildcardSslEnabled) {
    return null;
  }

  if (statusLoading || challengeLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64 mt-2" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  // Mock mode banner component
  const MockModeBanner = () => {
    if (!domainsConfig?.mockSslMode) return null;
    return (
      <Alert className="mb-4 bg-amber-50 dark:bg-amber-950 border-amber-300 dark:border-amber-700">
        <Wrench className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <AlertTitle className="text-amber-900 dark:text-amber-100">Mock SSL Mode Enabled</AlertTitle>
        <AlertDescription className="text-amber-800 dark:text-amber-200 text-sm">
          <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">MOCK_SSL=true</code> is set.
          No real certificates will be issued. DNS validation is simulated.
          This is for local development and UI testing only.
        </AlertDescription>
      </Alert>
    );
  };

  // Certificate exists and is valid (not self-signed)
  if (certStatus?.exists && !certStatus?.isSelfSigned) {
    const isExpiringSoon = certStatus.daysUntilExpiry && certStatus.daysUntilExpiry < 30;

    return (
      <>
      <MockModeBanner />
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-green-500" />
              <CardTitle>Wildcard SSL Certificate</CardTitle>
            </div>
            <Badge variant={isExpiringSoon ? 'destructive' : 'default'} className="gap-1">
              {isExpiringSoon ? (
                <>
                  <AlertTriangle className="h-3 w-3" />
                  Expiring Soon
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-3 w-3" />
                  Active
                </>
              )}
            </Badge>
          </div>
          <CardDescription>
            All subdomains automatically use HTTPS with this wildcard certificate
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Issuer</p>
              <p className="font-medium">{certStatus.issuer || 'Unknown'}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Expires</p>
              <p className="font-medium">{formatExpiryDate(certStatus.expiresAt)}</p>
            </div>
          </div>

          {isExpiringSoon && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Certificate Expiring Soon</AlertTitle>
              <AlertDescription>
                Your wildcard certificate will expire in {certStatus.daysUntilExpiry} days.
                Request a new certificate to avoid service interruption.
              </AlertDescription>
            </Alert>
          )}

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                refetchStatus();
                refetchChallenge();
              }}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh Status
            </Button>
            {isExpiringSoon && (
              <Button size="sm" onClick={handleRequestCertificate} disabled={isRequesting}>
                {isRequesting ? 'Requesting...' : 'Renew Certificate'}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDeleteDialog(true)}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </Button>
          </div>

          {/* Delete confirmation dialog */}
          <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Wildcard Certificate?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will remove the SSL certificate and disable HTTPS for all subdomains.
                  You will need to request a new certificate and complete DNS verification again to re-enable SSL.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDeleteCertificate}
                  disabled={isDeleting}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {isDeleting ? 'Deleting...' : 'Delete Certificate'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
      </>
    );
  }

  // Pending challenge exists - show DNS instructions
  if (pendingChallenge) {
    return (
      <>
      <MockModeBanner />
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-yellow-500" />
            <CardTitle>DNS Verification Required</CardTitle>
          </div>
          <CardDescription>
            Add the DNS TXT record below to verify domain ownership
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <Shield className="h-4 w-4" />
            <AlertTitle>Add this DNS TXT record</AlertTitle>
            <AlertDescription className="mt-2">
              <p className="mb-2">
                Go to your DNS provider and add the following TXT record:
              </p>
            </AlertDescription>
          </Alert>

          <div className="space-y-3 bg-muted p-4 rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase font-medium">Record Name</p>
                <code className="text-sm font-mono">{pendingChallenge.recordName}</code>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyToClipboard(pendingChallenge.recordName, 'Record Name')}
              >
                {copiedField === 'Record Name' ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>

            <div>
              <p className="text-xs text-muted-foreground uppercase font-medium">Record Type</p>
              <code className="text-sm font-mono">TXT</code>
            </div>

            {/* Show all record values - wildcard certs need multiple TXT records */}
            {pendingChallenge.recordValues && pendingChallenge.recordValues.length > 1 ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground uppercase font-medium">
                  Record Values ({pendingChallenge.recordValues.length} TXT records required)
                </p>
                <Alert variant="default" className="bg-yellow-50 dark:bg-yellow-950 border-yellow-200 dark:border-yellow-800 mb-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
                  <AlertDescription className="text-yellow-800 dark:text-yellow-200 text-xs">
                    <strong>Important:</strong> You must add {pendingChallenge.recordValues.length} TXT records with the same name but different values.
                    This is required for wildcard certificates covering both <code>*.domain</code> and <code>domain</code>.
                  </AlertDescription>
                </Alert>
                {pendingChallenge.recordValues.map((value: string, index: number) => (
                  <div key={index} className="flex items-start justify-between gap-2 bg-background p-2 rounded border">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground mb-1">Value {index + 1}</p>
                      <code className="text-sm font-mono break-all">{value}</code>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="flex-shrink-0"
                      onClick={() => copyToClipboard(value, `Value ${index + 1}`)}
                    >
                      {copiedField === `Value ${index + 1}` ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground uppercase font-medium">Record Value</p>
                  <code className="text-sm font-mono break-all">{pendingChallenge.recordValue}</code>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex-shrink-0"
                  onClick={() => copyToClipboard(pendingChallenge.recordValue, 'Record Value')}
                >
                  {copiedField === 'Record Value' ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            )}
          </div>

          <Alert variant="default" className="bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
            <AlertTriangle className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <AlertDescription className="text-blue-800 dark:text-blue-200">
              <strong>Note:</strong> After adding the DNS record, wait 1-2 minutes for DNS
              propagation before clicking verify.
            </AlertDescription>
          </Alert>

          {/* DNS Propagation Status */}
          {dnsStatus?.error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{dnsStatus.error}</AlertDescription>
            </Alert>
          )}
          {dnsStatus && !dnsStatus.error && (
            <Alert variant={dnsStatus.allFound ? 'default' : 'destructive'} className={dnsStatus.allFound ? 'bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800' : ''}>
              {dnsStatus.allFound ? (
                <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
              ) : (
                <AlertTriangle className="h-4 w-4" />
              )}
              <AlertTitle>
                {dnsStatus.allFound
                  ? 'DNS Records Found!'
                  : `Missing ${dnsStatus.missingValues.length} of ${dnsStatus.expectedValues.length} TXT Records`}
              </AlertTitle>
              <AlertDescription className="text-sm">
                {dnsStatus.allFound ? (
                  <span className="text-green-800 dark:text-green-200">
                    All required TXT records have propagated. You can now verify and issue the certificate.
                  </span>
                ) : (
                  <div className="space-y-1">
                    <p>Found {dnsStatus.foundValues.length} of {dnsStatus.expectedValues.length} required records.</p>
                    {dnsStatus.foundValues.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Found: {dnsStatus.foundValues.map(v => v.substring(0, 15) + '...').join(', ')}
                      </p>
                    )}
                  </div>
                )}
              </AlertDescription>
            </Alert>
          )}

          <div className="flex gap-2">
            <Button onClick={handleVerifyCertificate} disabled={isVerifying}>
              {isVerifying ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Verifying...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Verify & Issue Certificate
                </>
              )}
            </Button>
            <Button
              variant="outline"
              onClick={() => checkDns()}
              disabled={isCheckingDns}
            >
              {isCheckingDns ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Check DNS
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCancelChallenge}
              disabled={isCancelling}
              className="text-muted-foreground hover:text-destructive"
            >
              <X className="h-4 w-4 mr-2" />
              {isCancelling ? 'Cancelling...' : 'Cancel'}
            </Button>
          </div>
        </CardContent>
      </Card>
      </>
    );
  }

  // No certificate OR self-signed certificate - show request button
  const hasSelfSignedCert = certStatus?.exists && certStatus?.isSelfSigned;

  return (
    <>
    <MockModeBanner />
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-muted-foreground" />
          <CardTitle>Wildcard SSL Certificate</CardTitle>
        </div>
        <CardDescription>
          Enable HTTPS for all subdomains with a wildcard SSL certificate
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Wildcard DNS Setup Instructions */}
        <Alert className="bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
          <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <AlertTitle className="text-blue-900 dark:text-blue-100">DNS Setup Required for Subdomains</AlertTitle>
          <AlertDescription className="text-blue-800 dark:text-blue-200">
            <p className="mb-2">
              To use subdomain mappings (e.g., <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">coverage.{domainsConfig?.baseDomain || 'yourdomain.com'}</code>),
              you need a wildcard DNS record pointing to your server.
            </p>
            <div className="bg-white dark:bg-gray-900 p-3 rounded border border-blue-200 dark:border-blue-700 mt-2">
              <p className="text-xs text-muted-foreground uppercase font-medium mb-2">Add this DNS record at your domain registrar:</p>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <span className="text-xs text-muted-foreground">Type:</span>
                  <p className="font-mono font-medium">A</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Host:</span>
                  <p className="font-mono font-medium">*</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Value:</span>
                  <p className="font-mono font-medium">[Your Server IP]</p>
                </div>
              </div>
            </div>
            <p className="text-xs mt-2">
              This wildcard record (<code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">*</code>) routes all subdomains to your server,
              required for dynamic subdomain mappings to work.
            </p>
          </AlertDescription>
        </Alert>

        <Alert>
          <Shield className="h-4 w-4" />
          <AlertTitle>SSL Not Configured</AlertTitle>
          <AlertDescription>
            {hasSelfSignedCert ? (
              <>
                A temporary self-signed certificate is in place, but browsers will show security warnings.
                Request a proper wildcard certificate from Let's Encrypt for trusted HTTPS on all subdomains.
              </>
            ) : (
              <>
                A wildcard SSL certificate allows all your subdomains to use HTTPS automatically.
                You'll need to verify domain ownership by adding a DNS TXT record.
              </>
            )}
          </AlertDescription>
        </Alert>

        <div className="space-y-2 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">How it works:</p>
          <ol className="list-decimal list-inside space-y-1 ml-2">
            <li>Click "Request Certificate" to start the process</li>
            <li>Add the DNS TXT record shown to your DNS provider</li>
            <li>Wait 1-2 minutes for DNS propagation</li>
            <li>Click "Verify & Issue Certificate"</li>
            <li>All subdomains will automatically use HTTPS</li>
          </ol>
        </div>

        <Button onClick={handleRequestCertificate} disabled={isRequesting}>
          {isRequesting ? (
            <>
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              Requesting...
            </>
          ) : (
            <>
              <Shield className="h-4 w-4 mr-2" />
              Request Certificate
            </>
          )}
        </Button>
      </CardContent>
    </Card>
    </>
  );
}