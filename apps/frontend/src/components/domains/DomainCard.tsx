import { useState } from 'react';
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
  Clock,
  Copy,
  Check,
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
  useProvisionPlatformSslMutation,
} from '@/services/domainsApi';
import { useToast } from '@/hooks/use-toast';
import { useFeatureFlags } from '@/services/featureFlagsApi';

interface DomainCardProps {
  domain: DomainMapping;
  projectName?: string;
  onEdit: (domain: DomainMapping) => void;
  onDelete: (id: string) => void;
}

export function DomainCard({ domain, projectName, onEdit, onDelete }: DomainCardProps) {
  const { toast } = useToast();
  const { isEnabled, isLoading: flagsLoading, getValue } = useFeatureFlags();

  // State for DNS validation records (CNAME records for SSL provisioning)
  const [dnsValidationRecords, setDnsValidationRecords] = useState<
    { domain: string; name: string; value: string }[] | undefined
  >();
  // State for tracking if SSL is deferred (externally managed domains)
  const [sslDeferred, setSslDeferred] = useState(false);
  // State for tracking copied items (for copy button feedback)
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Helper to copy text to clipboard with visual feedback
  const copyToClipboard = async (text: string, fieldId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(fieldId);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      toast({
        title: 'Failed to copy',
        description: 'Could not copy to clipboard',
        variant: 'destructive',
      });
    }
  };

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
  const [provisionSsl, { isLoading: isProvisioningSsl }] = useProvisionPlatformSslMutation();

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

        // Check if DNS validation records are needed (externally managed domain)
        if (result.dnsValidationRecords && result.dnsValidationRecords.length > 0) {
          setDnsValidationRecords(result.dnsValidationRecords);
          setSslDeferred(result.sslDeferred ?? true);
          description += ' CNAME records are required for SSL certificate provisioning - see instructions below.';
        } else if (isPlatformMode) {
          // In platform mode with managed DNS, SSL is provisioned automatically
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

  const handleProvisionSsl = async () => {
    try {
      const result = await provisionSsl(domain.id).unwrap();
      if (result.success) {
        toast({
          title: 'SSL Provisioning Started',
          description: result.message || `SSL certificate is being provisioned for ${domain.domain}. This may take a few minutes.`,
        });
        // Clear the deferred state and validation records
        setSslDeferred(false);
        setDnsValidationRecords(undefined);
      } else {
        // Include missing records in the error message if provided
        let errorDesc = result.error || 'Failed to provision SSL certificate';
        if (result.missingRecords && result.missingRecords.length > 0) {
          errorDesc += ` Missing: ${result.missingRecords.join(', ')}`;
        }
        toast({
          title: 'SSL Provisioning Failed',
          description: errorDesc,
          variant: 'destructive',
        });
      }
    } catch (err: unknown) {
      const errorData = (err as { data?: { message?: string; error?: string; missingRecords?: string[] } })?.data;
      let errorMessage = errorData?.message || errorData?.error || 'Failed to provision SSL';
      if (errorData?.missingRecords && errorData.missingRecords.length > 0) {
        errorMessage += ` Missing: ${errorData.missingRecords.join(', ')}`;
      }
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
            {/* Project name as title for non-redirect domains */}
            {projectName && domain.domainType !== 'redirect' && (
              <p className="text-sm font-medium text-muted-foreground mb-1">
                {projectName}
              </p>
            )}
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
            <p className="text-xs text-muted-foreground mt-1">
              {domain.domainType === 'subdomain' ? 'Subdomain' : domain.domainType === 'redirect' ? 'Redirect Domain' : 'Custom Domain'}
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
            {/* DNS status - hidden when external proxy handles DNS/routing */}
            {/* Note: In platform mode, subdomains have wildcard DNS, but custom domains still need manual DNS */}
            {!isExternalProxyMode && (domain.domainType === 'custom' || domain.domainType === 'redirect') && (
              domain.dnsVerified ? (
                <div className="flex items-center gap-1 text-green-600">
                  <CheckCircle2 className="h-3 w-3" />
                  <span>DNS Verified</span>
                </div>
              ) : (
                <div className="flex items-center gap-1 text-yellow-600">
                  <AlertCircle className="h-3 w-3" />
                  <span>DNS Not Verified</span>
                </div>
              )
            )}
          </div>

          {/* SSL Certificate CNAME Records (for externally managed domains after DNS verification) */}
          {domain.dnsVerified && sslDeferred && dnsValidationRecords && dnsValidationRecords.length > 0 && (
            <div className="mt-2 p-3 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded text-xs space-y-2">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-amber-600" />
                <p className="font-medium text-amber-800 dark:text-amber-200">
                  SSL Certificate Provisioning - CNAME Records Required
                </p>
              </div>
              <p className="text-amber-700 dark:text-amber-300">
                Add the following CNAME record{dnsValidationRecords.length > 1 ? 's' : ''} at your domain registrar to complete SSL certificate provisioning:
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-amber-200 dark:border-amber-700">
                      <th className="py-1 pr-4 font-medium text-amber-800 dark:text-amber-200">Type</th>
                      <th className="py-1 pr-4 font-medium text-amber-800 dark:text-amber-200">Host</th>
                      <th className="py-1 font-medium text-amber-800 dark:text-amber-200">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dnsValidationRecords.map((record, idx) => {
                      // Strip apex domain suffix for providers like Namecheap that append it automatically
                      // For www subdomains, we need to keep the "www" part (e.g., _acme-challenge.www)
                      // Extract apex domain by removing www. prefix if present
                      const apexDomain = record.domain.startsWith('www.')
                        ? record.domain.slice(4)
                        : record.domain;
                      const hostWithoutDomain = record.name.endsWith(`.${apexDomain}`)
                        ? record.name.slice(0, -(apexDomain.length + 1))
                        : record.name;
                      return (
                        <tr key={record.name}>
                          <td className="py-1 pr-4">
                            <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded text-amber-800 dark:text-amber-200">CNAME</code>
                          </td>
                          <td className="py-1 pr-4">
                            <div className="flex items-center gap-1">
                              <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded text-amber-800 dark:text-amber-200 break-all">{hostWithoutDomain}</code>
                              <button
                                onClick={() => copyToClipboard(hostWithoutDomain, `name-${idx}`)}
                                className="p-1 hover:bg-amber-200 dark:hover:bg-amber-800 rounded transition-colors"
                                title="Copy host"
                              >
                                {copiedField === `name-${idx}` ? (
                                  <Check className="h-3 w-3 text-green-600" />
                                ) : (
                                  <Copy className="h-3 w-3 text-amber-600" />
                                )}
                              </button>
                            </div>
                          </td>
                          <td className="py-1">
                            <div className="flex items-center gap-1">
                              <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded text-amber-800 dark:text-amber-200 break-all">{record.value}</code>
                              <button
                                onClick={() => copyToClipboard(record.value, `value-${idx}`)}
                                className="p-1 hover:bg-amber-200 dark:hover:bg-amber-800 rounded transition-colors"
                                title="Copy value"
                              >
                                {copiedField === `value-${idx}` ? (
                                  <Check className="h-3 w-3 text-green-600" />
                                ) : (
                                  <Copy className="h-3 w-3 text-amber-600" />
                                )}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between pt-1">
                <p className="text-amber-600 dark:text-amber-400 text-xs">
                  After adding the CNAME records, click "Provision SSL". Certificate provisioning typically takes 5-15 minutes.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleProvisionSsl}
                  disabled={isProvisioningSsl}
                  className="ml-4 bg-amber-100 hover:bg-amber-200 dark:bg-amber-900 dark:hover:bg-amber-800 border-amber-300 dark:border-amber-700"
                >
                  {isProvisioningSsl ? (
                    <>
                      <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                      Provisioning...
                    </>
                  ) : (
                    <>
                      <Shield className="h-3 w-3 mr-1" />
                      Provision SSL
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* DNS Configuration help for unverified custom/redirect domains */}
          {/* Hidden when external proxy (Cloudflare) handles DNS/routing */}
          {/* Note: In platform mode, subdomains have wildcard DNS, but custom domains still need manual config */}
          {(domain.domainType === 'custom' || domain.domainType === 'redirect') &&
            !domain.dnsVerified &&
            !isExternalProxyMode &&
            dnsRequirements?.requirements && (
              <div className="mt-2 p-3 bg-muted rounded text-xs space-y-2">
                <p className="font-medium">DNS Configuration Required:</p>
                <p className="text-muted-foreground">
                  Add the following DNS record{domain.domain.startsWith('www.') ? 's' : ''} at your domain registrar:
                </p>
                {(() => {
                  const parts = domain.domain.split('.');
                  const isWww = parts[0] === 'www';
                  const isApex = parts.length === 2;
                  const host = isApex ? '@' : parts[0];
                  const cnameTarget = domainsConfig?.cnameTarget;
                  const platformIp = domainsConfig?.platformIp;

                  // Platform mode with CNAME target configured
                  if (isPlatformMode && cnameTarget) {
                    return (
                      <div className="space-y-3">
                        {/* Non-apex domains: Show CNAME (recommended) */}
                        {!isApex && (
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
                                <tr>
                                  <td className="py-1 pr-4">
                                    <code className="bg-background px-1 rounded">CNAME</code>
                                  </td>
                                  <td className="py-1 pr-4">
                                    <code className="bg-background px-1 rounded">{host}</code>
                                  </td>
                                  <td className="py-1 pr-4">
                                    <span className="inline-flex items-center gap-1">
                                      <code className="bg-background px-1 rounded">{cnameTarget}</code>
                                      <button
                                        onClick={() => copyToClipboard(cnameTarget!, `cname-${host}`)}
                                        className="p-0.5 hover:bg-muted rounded"
                                        title="Copy to clipboard"
                                      >
                                        {copiedField === `cname-${host}` ? (
                                          <Check className="h-3 w-3 text-green-500" />
                                        ) : (
                                          <Copy className="h-3 w-3 text-muted-foreground" />
                                        )}
                                      </button>
                                    </span>
                                  </td>
                                  <td className="py-1">Automatic</td>
                                </tr>
                                {/* If www subdomain, also suggest root domain */}
                                {isWww && (
                                  <tr className="text-muted-foreground">
                                    <td className="py-1 pr-4">
                                      <code className="bg-background px-1 rounded">ALIAS</code>
                                    </td>
                                    <td className="py-1 pr-4">
                                      <code className="bg-background px-1 rounded">@</code>
                                    </td>
                                    <td className="py-1 pr-4">
                                      <span className="inline-flex items-center gap-1">
                                        <code className="bg-background px-1 rounded">{cnameTarget}</code>
                                        <button
                                          onClick={() => copyToClipboard(cnameTarget!, 'alias-root')}
                                          className="p-0.5 hover:bg-muted rounded"
                                          title="Copy to clipboard"
                                        >
                                          {copiedField === 'alias-root' ? (
                                            <Check className="h-3 w-3 text-green-500" />
                                          ) : (
                                            <Copy className="h-3 w-3 text-muted-foreground" />
                                          )}
                                        </button>
                                      </span>
                                    </td>
                                    <td className="py-1">Automatic</td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        )}

                        {/* Apex domains: Show ALIAS (preferred) + A record (fallback) */}
                        {isApex && (
                          <>
                            <p className="text-muted-foreground">
                              <strong>Option 1 (Recommended):</strong> If your DNS provider supports ALIAS/ANAME records
                              (Namecheap, Cloudflare, Route 53, DNSimple):
                            </p>
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
                                  <tr>
                                    <td className="py-1 pr-4">
                                      <code className="bg-background px-1 rounded">ALIAS</code>
                                    </td>
                                    <td className="py-1 pr-4">
                                      <code className="bg-background px-1 rounded">@</code>
                                    </td>
                                    <td className="py-1 pr-4">
                                      <span className="inline-flex items-center gap-1">
                                        <code className="bg-background px-1 rounded">{cnameTarget}</code>
                                        <button
                                          onClick={() => copyToClipboard(cnameTarget!, 'apex-alias')}
                                          className="p-0.5 hover:bg-muted rounded"
                                          title="Copy to clipboard"
                                        >
                                          {copiedField === 'apex-alias' ? (
                                            <Check className="h-3 w-3 text-green-500" />
                                          ) : (
                                            <Copy className="h-3 w-3 text-muted-foreground" />
                                          )}
                                        </button>
                                      </span>
                                    </td>
                                    <td className="py-1">Automatic</td>
                                  </tr>
                                  <tr className="text-muted-foreground">
                                    <td className="py-1 pr-4">
                                      <code className="bg-background px-1 rounded">CNAME</code>
                                    </td>
                                    <td className="py-1 pr-4">
                                      <code className="bg-background px-1 rounded">www</code>
                                    </td>
                                    <td className="py-1 pr-4">
                                      <span className="inline-flex items-center gap-1">
                                        <code className="bg-background px-1 rounded">{cnameTarget}</code>
                                        <button
                                          onClick={() => copyToClipboard(cnameTarget!, 'apex-www-cname')}
                                          className="p-0.5 hover:bg-muted rounded"
                                          title="Copy to clipboard"
                                        >
                                          {copiedField === 'apex-www-cname' ? (
                                            <Check className="h-3 w-3 text-green-500" />
                                          ) : (
                                            <Copy className="h-3 w-3 text-muted-foreground" />
                                          )}
                                        </button>
                                      </span>
                                    </td>
                                    <td className="py-1">Automatic</td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>

                            {platformIp && (
                              <>
                                <p className="text-muted-foreground">
                                  <strong>Option 2:</strong> If your DNS provider doesn't support ALIAS records
                                  (GoDaddy, Google Domains):
                                </p>
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
                                      <tr>
                                        <td className="py-1 pr-4">
                                          <code className="bg-background px-1 rounded">A</code>
                                        </td>
                                        <td className="py-1 pr-4">
                                          <code className="bg-background px-1 rounded">@</code>
                                        </td>
                                        <td className="py-1 pr-4">
                                          <span className="inline-flex items-center gap-1">
                                            <code className="bg-background px-1 rounded">{platformIp}</code>
                                            <button
                                              onClick={() => copyToClipboard(platformIp!, 'apex-a-record')}
                                              className="p-0.5 hover:bg-muted rounded"
                                              title="Copy to clipboard"
                                            >
                                              {copiedField === 'apex-a-record' ? (
                                                <Check className="h-3 w-3 text-green-500" />
                                              ) : (
                                                <Copy className="h-3 w-3 text-muted-foreground" />
                                              )}
                                            </button>
                                          </span>
                                        </td>
                                        <td className="py-1">Automatic</td>
                                      </tr>
                                      <tr className="text-muted-foreground">
                                        <td className="py-1 pr-4">
                                          <code className="bg-background px-1 rounded">CNAME</code>
                                        </td>
                                        <td className="py-1 pr-4">
                                          <code className="bg-background px-1 rounded">www</code>
                                        </td>
                                        <td className="py-1 pr-4">
                                          <span className="inline-flex items-center gap-1">
                                            <code className="bg-background px-1 rounded">{cnameTarget}</code>
                                            <button
                                              onClick={() => copyToClipboard(cnameTarget!, 'opt2-www-cname')}
                                              className="p-0.5 hover:bg-muted rounded"
                                              title="Copy to clipboard"
                                            >
                                              {copiedField === 'opt2-www-cname' ? (
                                                <Check className="h-3 w-3 text-green-500" />
                                              ) : (
                                                <Copy className="h-3 w-3 text-muted-foreground" />
                                              )}
                                            </button>
                                          </span>
                                        </td>
                                        <td className="py-1">Automatic</td>
                                      </tr>
                                    </tbody>
                                  </table>
                                </div>
                                <p className="text-amber-600 dark:text-amber-500">
                                  <AlertCircle className="h-3 w-3 inline mr-1" />
                                  A records point to an IP address that may change in the future. We recommend using
                                  ALIAS/ANAME records when possible to avoid manual updates.
                                </p>
                              </>
                            )}
                          </>
                        )}

                        {!isApex && isWww && (
                          <p className="text-muted-foreground">
                            Use <code className="bg-background px-1 rounded">ALIAS</code> for the{' '}
                            <code className="bg-background px-1 rounded">@</code> record if your DNS provider supports
                            it (Namecheap, Cloudflare, Route 53). Otherwise, use an A record pointing to{' '}
                            <code className="bg-background px-1 rounded">{platformIp}</code>.
                          </p>
                        )}
                      </div>
                    );
                  }

                  // Self-hosted or platform without CNAME target: Show A records
                  if (platformIp) {
                    const rows = [{ host, value: platformIp }];
                    if (isWww) {
                      rows.push({ host: '@', value: platformIp });
                    }
                    if (isApex) {
                      rows.push({ host: 'www', value: platformIp });
                    }

                    return (
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
                            {rows.map((row, i) => (
                              <tr key={row.host} className={i > 0 ? 'text-muted-foreground' : ''}>
                                <td className="py-1 pr-4">
                                  <code className="bg-background px-1 rounded">A</code>
                                </td>
                                <td className="py-1 pr-4">
                                  <code className="bg-background px-1 rounded">{row.host}</code>
                                </td>
                                <td className="py-1 pr-4">
                                  <span className="inline-flex items-center gap-1">
                                    <code className="bg-background px-1 rounded">{row.value}</code>
                                    <button
                                      onClick={() => copyToClipboard(row.value, `a-record-${row.host}`)}
                                      className="p-0.5 hover:bg-muted rounded"
                                      title="Copy to clipboard"
                                    >
                                      {copiedField === `a-record-${row.host}` ? (
                                        <Check className="h-3 w-3 text-green-500" />
                                      ) : (
                                        <Copy className="h-3 w-3 text-muted-foreground" />
                                      )}
                                    </button>
                                  </span>
                                </td>
                                <td className="py-1">Automatic</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  }

                  // No IP configured (self-hosted without known IP)
                  return (
                    <p>
                      Add an <strong>A record</strong> pointing to this server's IP address.
                    </p>
                  );
                })()}
                {domain.domain.startsWith('www.') && !domainsConfig?.cnameTarget && (
                  <p className="text-muted-foreground">
                    The <code className="bg-background px-1 rounded">@</code> record is recommended so{' '}
                    <strong>{domain.domain.replace('www.', '')}</strong> also resolves to your site.
                  </p>
                )}
                {!domain.domain.startsWith('www.') &&
                  domain.domain.split('.').length === 2 &&
                  !domainsConfig?.cnameTarget && (
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
        {/* Hidden when external proxy (Cloudflare) handles DNS/routing */}
        {/* Note: In platform mode, subdomains have wildcard DNS, but custom domains still need manual verification */}
        {!isExternalProxyMode && (domain.domainType === 'custom' || domain.domainType === 'redirect') && (
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
