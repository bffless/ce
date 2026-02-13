import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import {
  ExternalLink,
  Edit,
  Trash2,
  CheckCircle2,
  XCircle,
  Shield,
  ShieldOff,
  AlertCircle,
  RefreshCw,
  Globe,
  Lock,
  Split,
  ArrowRight,
} from 'lucide-react';
import type { DomainMapping } from '@/services/domainsApi';
import {
  useRequestDomainSslMutation,
  useGetWildcardCertificateStatusQuery,
  useGetDomainVisibilityQuery,
  useVerifyDomainDnsMutation,
  useGetDomainDnsRequirementsQuery,
  useGetTrafficConfigQuery,
  useGetDomainsConfigQuery,
} from '@/services/domainsApi';
import { useToast } from '@/hooks/use-toast';
import { useFeatureFlags } from '@/services/featureFlagsApi';

interface DomainCardProps {
  domain: DomainMapping;
  onEdit: (domain: DomainMapping) => void;
  onDelete: (id: string) => void;
}

export function DomainCard({ domain, onEdit, onDelete }: DomainCardProps) {
  const { toast } = useToast();
  const { isEnabled, isLoading: flagsLoading, getValue } = useFeatureFlags();

  // Detect external proxy mode: SSL is handled by Cloudflare (proxy or tunnel), DNS is managed externally
  const proxyMode = getValue<string>('PROXY_MODE', 'none');
  const isExternalProxyMode = proxyMode === 'cloudflare-tunnel' || proxyMode === 'cloudflare';

  // In external proxy mode, always use HTTPS URLs since external proxy handles SSL
  const fullUrl = `http${domain.sslEnabled || isExternalProxyMode ? 's' : ''}://${domain.domain}`;

  // Check wildcard cert status for subdomains (only when feature is enabled)
  const wildcardSslEnabled = isEnabled('ENABLE_WILDCARD_SSL');
  const { data: wildcardStatus } = useGetWildcardCertificateStatusQuery(undefined, {
    skip: domain.domainType !== 'subdomain' || flagsLoading || !wildcardSslEnabled,
  });

  // Detect PaaS mode: SSL is managed externally (Traefik handles certificates)
  const sslToggleEnabled = isEnabled('ENABLE_DOMAIN_SSL_TOGGLE');
  const isPlatformMode = !sslToggleEnabled && !flagsLoading;

  // Phase B5: Get visibility info
  const { data: visibilityInfo } = useGetDomainVisibilityQuery(domain.id);

  const [requestSsl, { isLoading: isRequestingSsl }] = useRequestDomainSslMutation();
  const [verifyDns, { isLoading: isVerifyingDns }] = useVerifyDomainDnsMutation();

  // Get DNS requirements for custom/redirect domains
  const { data: dnsRequirements } = useGetDomainDnsRequirementsQuery(domain.id, {
    skip: (domain.domainType !== 'custom' && domain.domainType !== 'redirect') || domain.dnsVerified,
  });

  // Get domains config for platform IP
  const { data: domainsConfig } = useGetDomainsConfigQuery(undefined, {
    skip: domain.domainType !== 'custom' && domain.domainType !== 'redirect',
  });

  // Phase C: Get traffic config for multivariant routing
  const { data: trafficConfig } = useGetTrafficConfigQuery(domain.id);

  const handleVerifyDns = async () => {
    try {
      const result = await verifyDns(domain.id).unwrap();
      if (result.verified) {
        // Build description based on alternate domain status and platform mode
        let description = `DNS is now verified for ${domain.domain}.`;
        if (result.alternateDomain) {
          if (result.alternateDomainVerified) {
            description += ` ${result.alternateDomain} is also verified - SSL will cover both domains.`;
          } else {
            description += ` Add DNS for ${result.alternateDomain} to enable HTTPS redirects.`;
          }
        }
        // In platform mode, SSL is provisioned automatically
        if (isPlatformMode) {
          description += ' SSL certificate will be provisioned automatically.';
        } else if (!domain.sslEnabled) {
          description += ' You can now enable SSL.';
        }

        toast({
          title: 'DNS Verified',
          description,
        });
      } else {
        toast({
          title: 'DNS Not Verified',
          description: result.error || `Domain does not resolve to the expected IP address.`,
          variant: 'destructive',
        });
      }
    } catch (err: unknown) {
      const errorMessage =
        (err as { data?: { message?: string; error?: string } })?.data?.message ||
        (err as { data?: { message?: string; error?: string } })?.data?.error ||
        'Failed to verify DNS';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  const canEnableSsl = () => {
    // In platform mode, SSL is managed externally (Traefik auto-provisions)
    if (isPlatformMode) return false;
    if (domain.sslEnabled) return false;
    if (domain.domainType === 'subdomain') {
      return wildcardStatus?.exists === true;
    }
    // Custom domain requires DNS verification first
    return domain.dnsVerified;
  };

  const handleEnableSsl = async () => {
    try {
      const result = await requestSsl(domain.id).unwrap();
      if (result.success) {
        toast({
          title: 'SSL Enabled',
          description: `HTTPS is now enabled for ${domain.domain}`,
        });
      } else {
        toast({
          title: 'Failed to enable SSL',
          description: result.message || 'An error occurred',
          variant: 'destructive',
        });
      }
    } catch (err: unknown) {
      const errorMessage =
        (err as { data?: { message?: string } })?.data?.message || 'Failed to enable SSL';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  const formatExpiryDate = (dateStr?: string) => {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    const now = new Date();
    const daysUntilExpiry = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntilExpiry < 30) {
      return { text: `Expires in ${daysUntilExpiry} days`, isWarning: true };
    }
    return { text: `Expires ${date.toLocaleDateString()}`, isWarning: false };
  };

  const sslExpiry = domain.sslExpiresAt ? formatExpiryDate(domain.sslExpiresAt) : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <a
                href={fullUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-lg font-semibold hover:underline"
              >
                {domain.domain}
              </a>
              <ExternalLink className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Type: {domain.domainType === 'subdomain' ? 'Subdomain' : domain.domainType === 'redirect' ? 'Redirect Domain' : 'Custom Domain'}
            </p>
            {/* Show redirect target for redirect domains */}
            {domain.domainType === 'redirect' && domain.redirectTarget && (
              <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
                <ArrowRight className="h-3 w-3" />
                Redirects to: <span className="font-medium">{domain.redirectTarget}</span>
              </p>
            )}
          </div>

          <div className="flex gap-2">
            {/* Phase B5: Visibility badge */}
            {visibilityInfo && (
              <Badge
                variant={visibilityInfo.effectiveVisibility === 'public' ? 'outline' : 'secondary'}
                title={`Visibility: ${visibilityInfo.effectiveVisibility} (from ${visibilityInfo.source})`}
              >
                {visibilityInfo.effectiveVisibility === 'public' ? (
                  <>
                    <Globe className="h-3 w-3 mr-1" />
                    Public
                  </>
                ) : (
                  <>
                    <Lock className="h-3 w-3 mr-1" />
                    Private
                  </>
                )}
              </Badge>
            )}
            {domain.isActive ? (
              <Badge className="bg-green-600 hover:bg-green-500 text-white">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Active
              </Badge>
            ) : (
              <Badge variant="secondary">
                <XCircle className="h-3 w-3 mr-1" />
                Inactive
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div className="space-y-2 text-sm">
          {/* Mapping section - only for subdomain and custom domains */}
          {domain.domainType !== 'redirect' && (
            <div>
              <span className="font-medium">Mapping:</span>{' '}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">
                /{domain.alias || 'latest'}
                {domain.path || ''}
              </code>
            </div>
          )}

          {/* Phase C: Traffic split indicator - only for non-redirect domains */}
          {domain.domainType !== 'redirect' && trafficConfig && trafficConfig.weights.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="font-medium flex items-center gap-1">
                <Split className="h-3 w-3 text-purple-600" />
                Traffic Split:
              </span>
              <div className="flex flex-wrap gap-1">
                {trafficConfig.weights.map((w) => (
                  <Badge key={w.alias} variant="outline" className="text-xs">
                    {w.alias}: {w.weight}%
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-4">
            {domain.sslEnabled ? (
              <div className="flex items-center gap-1 text-green-600">
                <Shield className="h-3 w-3" />
                <span>SSL Enabled</span>
                {sslExpiry && (
                  <span
                    className={`text-xs ${sslExpiry.isWarning ? 'text-yellow-600' : 'text-muted-foreground'}`}
                  >
                    ({sslExpiry.text})
                  </span>
                )}
              </div>
            ) : isExternalProxyMode || isPlatformMode ? (
              <div className="flex items-center gap-1 text-green-600">
                <Shield className="h-3 w-3" />
                <span>SSL via {isExternalProxyMode ? 'Cloudflare' : 'Platform'}</span>
              </div>
            ) : (
              <div className="flex items-center gap-1 text-muted-foreground">
                <ShieldOff className="h-3 w-3" />
                <span>SSL Disabled</span>
              </div>
            )}
            {/* DNS status - hidden when external proxy or platform handles DNS/routing */}
            {!isExternalProxyMode && !isPlatformMode && (
              domain.dnsVerified ? (
                <div className="flex items-center gap-1 text-green-600">
                  <CheckCircle2 className="h-3 w-3" />
                  <span>DNS Verified</span>
                </div>
              ) : (domain.domainType === 'custom' || domain.domainType === 'redirect') ? (
                <div className="flex items-center gap-1 text-yellow-600">
                  <AlertCircle className="h-3 w-3" />
                  <span>DNS Not Verified</span>
                </div>
              ) : null
            )}
          </div>

          {/* DNS Configuration help for unverified custom/redirect domains */}
          {/* Hidden when external proxy (Cloudflare) or platform (Traefik) handles DNS/routing */}
          {(domain.domainType === 'custom' || domain.domainType === 'redirect') &&
            !domain.dnsVerified &&
            !isExternalProxyMode &&
            !isPlatformMode &&
            dnsRequirements?.requirements && (
              <div className="mt-2 p-3 bg-muted rounded text-xs space-y-2">
                <p className="font-medium">DNS Configuration Required:</p>
                <p className="text-muted-foreground">
                  Add the following DNS record{domain.domain.startsWith('www.') ? 's' : ''} at your domain registrar:
                </p>
                {domainsConfig?.platformIp && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="py-1 pr-4 font-medium">Type</th>
                          <th className="py-1 pr-4 font-medium">Host</th>
                          <th className="py-1 pr-4 font-medium">Value</th>
                          <th className="py-1 font-medium">TTL</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          const parts = domain.domain.split('.');
                          const isWww = parts[0] === 'www';
                          const isRoot = parts.length === 2;
                          // Determine the host value for the A record
                          const host = isRoot ? '@' : parts[0];
                          const rows = [{ host, value: domainsConfig.platformIp }];
                          // If www subdomain, also suggest root domain record
                          if (isWww) {
                            rows.push({ host: '@', value: domainsConfig.platformIp });
                          }
                          // If root domain, also suggest www record
                          if (isRoot) {
                            rows.push({ host: 'www', value: domainsConfig.platformIp });
                          }
                          return rows.map((row, i) => (
                            <tr key={row.host} className={i > 0 ? 'text-muted-foreground' : ''}>
                              <td className="py-1 pr-4">
                                <code className="bg-background px-1 rounded">A</code>
                              </td>
                              <td className="py-1 pr-4">
                                <code className="bg-background px-1 rounded">{row.host}</code>
                              </td>
                              <td className="py-1 pr-4">
                                <code className="bg-background px-1 rounded">{row.value}</code>
                              </td>
                              <td className="py-1">Automatic</td>
                            </tr>
                          ));
                        })()}
                      </tbody>
                    </table>
                  </div>
                )}
                {!domainsConfig?.platformIp && (
                  <p>
                    Add an <strong>A record</strong> pointing to this server's IP address.
                  </p>
                )}
                {domain.domain.startsWith('www.') && (
                  <p className="text-muted-foreground">
                    The <code className="bg-background px-1 rounded">@</code> record is recommended so{' '}
                    <strong>{domain.domain.replace('www.', '')}</strong> also resolves to your site.
                  </p>
                )}
                {!domain.domain.startsWith('www.') && domain.domain.split('.').length === 2 && (
                  <p className="text-muted-foreground">
                    The <code className="bg-background px-1 rounded">www</code> record is recommended so{' '}
                    <strong>www.{domain.domain}</strong> also resolves to your site.
                  </p>
                )}
                {isPlatformMode && (
                  <p className="text-muted-foreground">
                    SSL certificate will be provisioned automatically after DNS verification.
                  </p>
                )}
              </div>
            )}

          <div className="text-xs text-muted-foreground">
            Created: {new Date(domain.createdAt).toLocaleDateString()}
          </div>
        </div>
      </CardContent>

      <CardFooter className="flex justify-end gap-2">
        {/* Verify/Re-check DNS button for custom and redirect domains */}
        {/* Hidden when external proxy (Cloudflare) or platform (Traefik) handles DNS/routing */}
        {!isExternalProxyMode && !isPlatformMode && (domain.domainType === 'custom' || domain.domainType === 'redirect') && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleVerifyDns}
            disabled={isVerifyingDns}
            title={
              domain.dnsVerified
                ? 'Re-check DNS status (useful after adding alternate domain)'
                : 'Check if DNS is correctly configured'
            }
          >
            {isVerifyingDns ? (
              <>
                <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                Checking...
              </>
            ) : domain.dnsVerified ? (
              <>
                <RefreshCw className="h-3 w-3 mr-1" />
                Re-check DNS
              </>
            ) : (
              <>
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Verify DNS
              </>
            )}
          </Button>
        )}
        {!domain.sslEnabled && canEnableSsl() && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleEnableSsl}
            disabled={isRequestingSsl}
            title="Enable HTTPS for this domain"
          >
            {isRequestingSsl ? (
              <>
                <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                Enabling...
              </>
            ) : (
              <>
                <Shield className="h-3 w-3 mr-1" />
                Enable SSL
              </>
            )}
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => onEdit(domain)}>
          <Edit className="h-3 w-3 mr-1" />
          Edit
        </Button>
        <Button variant="destructive" size="sm" onClick={() => onDelete(domain.id)}>
          <Trash2 className="h-3 w-3 mr-1" />
          Delete
        </Button>
      </CardFooter>
    </Card>
  );
}
