import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  RefreshCw,
  Clock,
  Info,
} from 'lucide-react';
import {
  useGetSslDetailsQuery,
  useRenewCertificateMutation,
  useUpdateAutoRenewMutation,
  useGetWildcardCertDetailsQuery,
} from '@/services/domainsApi';
import { useToast } from '@/hooks/use-toast';
import { format, formatDistanceToNow } from 'date-fns';

interface SslTabProps {
  domainId: string;
  domain: string;
  domainType: 'subdomain' | 'custom' | 'redirect';
}

export function SslTab({ domainId, domain, domainType }: SslTabProps) {
  // For subdomains, we show wildcard cert info (read-only)
  // For custom/redirect domains, we show individual cert with actions

  if (domainType === 'subdomain') {
    return <SubdomainSslTab domainId={domainId} domain={domain} />;
  }

  // Both custom and redirect domains use individual SSL certificates
  return <CustomDomainSslTab domainId={domainId} domain={domain} />;
}

/**
 * READ-ONLY SSL tab for subdomains
 * Shows wildcard certificate info without renewal option
 */
function SubdomainSslTab({
  domainId: _domainId,
  domain: _domain,
}: {
  domainId: string;
  domain: string;
}) {
  const { data: wildcardInfo, isLoading } = useGetWildcardCertDetailsQuery();

  if (isLoading) {
    return (
      <div className="p-4 text-muted-foreground">Loading SSL details...</div>
    );
  }

  if (!wildcardInfo?.certificate) {
    return (
      <Alert>
        <ShieldAlert className="h-4 w-4" />
        <AlertDescription>
          Wildcard certificate not found. Contact administrator.
        </AlertDescription>
      </Alert>
    );
  }

  const cert = wildcardInfo.certificate;

  return (
    <div className="space-y-6">
      {/* Info Banner - Read Only Notice */}
      <Alert className="bg-blue-50 border-blue-200">
        <Info className="h-4 w-4 text-blue-500" />
        <AlertDescription className="text-blue-700">
          This subdomain uses the platform's{' '}
          <strong>wildcard certificate</strong>. Certificate management is
          handled at the platform level.
        </AlertDescription>
      </Alert>

      {/* Status Banner */}
      <div
        className={`flex items-center gap-2 p-3 rounded-lg ${
          cert.isValid
            ? cert.isExpiringSoon
              ? 'bg-yellow-50 border border-yellow-200'
              : 'bg-green-50 border border-green-200'
            : 'bg-red-50 border border-red-200'
        }`}
      >
        {cert.isValid ? (
          cert.isExpiringSoon ? (
            <ShieldAlert className="h-5 w-5 text-yellow-500" />
          ) : (
            <ShieldCheck className="h-5 w-5 text-green-500" />
          )
        ) : (
          <ShieldAlert className="h-5 w-5 text-red-500" />
        )}
        <span className="font-medium">
          {cert.isValid
            ? cert.isExpiringSoon
              ? 'Wildcard certificate expiring soon'
              : 'Wildcard certificate valid'
            : 'Wildcard certificate expired or invalid'}
        </span>
      </div>

      {/* Wildcard Certificate Details */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium">Wildcard Certificate Details</h3>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">Certificate</span>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="secondary">Wildcard</Badge>
              <span className="font-mono text-xs">
                *.{wildcardInfo.baseDomain}
              </span>
            </div>
          </div>

          <div>
            <span className="text-muted-foreground">Issuer</span>
            <div className="mt-1">{cert.issuer}</div>
          </div>

          <div>
            <span className="text-muted-foreground">Expires</span>
            <div className="mt-1 flex items-center gap-2">
              <span>{format(new Date(cert.expiresAt), 'PPP')}</span>
              <Badge variant={cert.isExpiringSoon ? 'destructive' : 'outline'}>
                {cert.daysUntilExpiry} days
              </Badge>
            </div>
          </div>

          <div>
            <span className="text-muted-foreground">Covers</span>
            <div className="mt-1 text-xs text-muted-foreground">
              All *.{wildcardInfo.baseDomain} subdomains
            </div>
          </div>
        </div>
      </div>

      {/* No Renewal Actions - Subdomain cannot renew wildcard */}
      <div className="border-t pt-4">
        <p className="text-sm text-muted-foreground">
          <Shield className="h-4 w-4 inline mr-1" />
          Certificate renewal is managed at the platform level. The wildcard
          certificate automatically covers this subdomain.
        </p>
      </div>
    </div>
  );
}

/**
 * FULL SSL tab for custom domains
 * Shows individual certificate with renewal actions
 */
function CustomDomainSslTab({
  domainId,
  domain,
}: {
  domainId: string;
  domain: string;
}) {
  const { toast } = useToast();
  const {
    data: sslInfo,
    isLoading,
    refetch,
  } = useGetSslDetailsQuery(domainId);
  const [renewCertificate, { isLoading: isRenewing }] =
    useRenewCertificateMutation();
  const [updateAutoRenew] = useUpdateAutoRenewMutation();

  const handleRenew = async () => {
    if (
      !confirm(
        'Are you sure you want to renew the SSL certificate? This may take a few moments.'
      )
    ) {
      return;
    }

    try {
      const result = await renewCertificate(domainId).unwrap();
      if (result.success) {
        toast({
          title: 'Certificate renewed',
          description: 'Certificate renewed successfully',
        });
        refetch();
      } else {
        toast({
          title: 'Renewal failed',
          description: result.error || 'Failed to renew certificate',
          variant: 'destructive',
        });
      }
    } catch (error: unknown) {
      const err = error as { data?: { message?: string } };
      toast({
        title: 'Error',
        description: err.data?.message || 'Failed to renew certificate',
        variant: 'destructive',
      });
    }
  };

  const handleToggleAutoRenew = async (enabled: boolean) => {
    try {
      await updateAutoRenew({ domainId, enabled }).unwrap();
      toast({
        title: 'Setting updated',
        description: `Auto-renewal ${enabled ? 'enabled' : 'disabled'}`,
      });
    } catch (error: unknown) {
      const err = error as { data?: { message?: string } };
      toast({
        title: 'Error',
        description: err.data?.message || 'Failed to update setting',
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return (
      <div className="p-4 text-muted-foreground">Loading SSL details...</div>
    );
  }

  if (!sslInfo) {
    return (
      <Alert>
        <ShieldAlert className="h-4 w-4" />
        <AlertDescription>
          Unable to load SSL certificate information.
        </AlertDescription>
      </Alert>
    );
  }

  if (!sslInfo.sslEnabled) {
    return (
      <div className="space-y-4">
        <Alert>
          <ShieldAlert className="h-4 w-4" />
          <AlertDescription>
            SSL is not enabled for this domain. Enable SSL to secure your domain
            with HTTPS.
          </AlertDescription>
        </Alert>
        <Button onClick={handleRenew} disabled={isRenewing}>
          <Shield className="h-4 w-4 mr-2" />
          Enable SSL
        </Button>
      </div>
    );
  }

  const StatusIcon = sslInfo.isValid
    ? sslInfo.isExpiringSoon
      ? ShieldAlert
      : ShieldCheck
    : ShieldAlert;

  const statusColor = sslInfo.isValid
    ? sslInfo.isExpiringSoon
      ? 'text-yellow-500'
      : 'text-green-500'
    : 'text-red-500';

  return (
    <div className="space-y-6">
      {/* Status Banner */}
      <div
        className={`flex items-center gap-2 p-3 rounded-lg ${
          sslInfo.isValid
            ? sslInfo.isExpiringSoon
              ? 'bg-yellow-50 border border-yellow-200'
              : 'bg-green-50 border border-green-200'
            : 'bg-red-50 border border-red-200'
        }`}
      >
        <StatusIcon className={`h-5 w-5 ${statusColor}`} />
        <span className={`font-medium ${statusColor}`}>
          {sslInfo.isValid
            ? sslInfo.isExpiringSoon
              ? 'Certificate expiring soon'
              : 'Certificate valid'
            : 'Certificate expired or invalid'}
        </span>
      </div>

      {/* Certificate Details */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium">Certificate Details</h3>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">Type</span>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="outline">Individual</Badge>
            </div>
          </div>

          <div className="min-w-0">
            <span className="text-muted-foreground">Common Name</span>
            <div className="font-mono mt-1 truncate" title={sslInfo.commonName}>
              {sslInfo.commonName}
            </div>
          </div>

          <div>
            <span className="text-muted-foreground">Issuer</span>
            <div className="mt-1">{sslInfo.issuer}</div>
          </div>

          <div>
            <span className="text-muted-foreground">Issued</span>
            <div className="mt-1">
              {format(new Date(sslInfo.issuedAt), 'PPP')}
            </div>
          </div>

          <div>
            <span className="text-muted-foreground">Expires</span>
            <div className="mt-1 flex items-center gap-2">
              <span>{format(new Date(sslInfo.expiresAt), 'PPP')}</span>
              <Badge
                variant={sslInfo.isExpiringSoon ? 'destructive' : 'outline'}
              >
                {sslInfo.daysUntilExpiry} days
              </Badge>
            </div>
          </div>

          <div>
            <span className="text-muted-foreground">Serial Number</span>
            <div
              className="font-mono text-xs mt-1 truncate"
              title={sslInfo.serialNumber}
            >
              {sslInfo.serialNumber.slice(0, 20)}...
            </div>
          </div>
        </div>
      </div>

      {/* Auto-Renewal Settings */}
      <div className="border-t pt-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium">Auto-Renewal</h3>
            <p className="text-sm text-muted-foreground">
              Automatically renew certificate before expiration
            </p>
          </div>
          <Switch
            checked={sslInfo.autoRenewEnabled}
            onCheckedChange={handleToggleAutoRenew}
          />
        </div>

        {sslInfo.lastRenewalAt && (
          <div className="mt-3 text-sm text-muted-foreground flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Last renewal:{' '}
            {formatDistanceToNow(new Date(sslInfo.lastRenewalAt), {
              addSuffix: true,
            })}
            {sslInfo.lastRenewalStatus && (
              <Badge
                variant={
                  sslInfo.lastRenewalStatus === 'success'
                    ? 'outline'
                    : 'destructive'
                }
              >
                {sslInfo.lastRenewalStatus}
              </Badge>
            )}
          </div>
        )}
      </div>

      {/* Manual Renewal - ONLY for custom domains */}
      <div className="border-t pt-4">
        <Button onClick={handleRenew} disabled={isRenewing} variant="outline">
          <RefreshCw
            className={`h-4 w-4 mr-2 ${isRenewing ? 'animate-spin' : ''}`}
          />
          {isRenewing ? 'Renewing...' : 'Renew Now'}
        </Button>
        <p className="text-xs text-muted-foreground mt-2">
          This will request a new SSL certificate for {domain}.
        </p>
      </div>
    </div>
  );
}
