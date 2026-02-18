import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Globe, Lock, ArrowDown, AlertCircle, ArrowRight } from 'lucide-react';
import type { CreateDomainDto, WwwBehavior } from '@/services/domainsApi';
import { useFeatureFlags } from '@/services/featureFlagsApi';
import { useGetPrimaryContentProjectsQuery } from '@/services/settingsApi';
import { PathTypeahead } from './PathTypeahead';

interface DomainFormProps {
  projectId: string;
  baseDomain?: string;
  onSubmit: (data: CreateDomainDto) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

/**
 * Detect if a domain is www or apex, and return the alternate.
 * - www.example.com -> example.com
 * - example.com -> www.example.com
 * Returns null if not applicable (subdomains like api.example.com)
 */
function getAlternateDomain(domain: string): { alternate: string; isWww: boolean } | null {
  const parts = domain.split('.');
  if (parts.length < 2) return null;

  // If starts with www, return without www
  if (parts[0] === 'www') {
    return { alternate: parts.slice(1).join('.'), isWww: true };
  }

  // If it's an apex domain (exactly 2 parts), return with www
  if (parts.length === 2) {
    return { alternate: `www.${domain}`, isWww: false };
  }

  // Handle common two-part TLDs like .co.uk, .com.au
  const commonTwoPartTlds = ['co.uk', 'com.au', 'co.nz', 'org.uk', 'com.br', 'co.jp'];
  const lastTwo = parts.slice(-2).join('.');
  if (commonTwoPartTlds.includes(lastTwo) && parts.length === 3) {
    return { alternate: `www.${domain}`, isWww: false };
  }

  return null;
}

export function DomainForm({
  projectId,
  baseDomain = 'localhost',
  onSubmit,
  onCancel,
  isLoading = false,
}: DomainFormProps) {
  // Feature flags
  const { isEnabled } = useFeatureFlags();
  const showSslToggle = isEnabled('ENABLE_DOMAIN_SSL_TOGGLE');
  const customDomainsEnabled = isEnabled('ENABLE_CUSTOM_DOMAINS');

  // Get available aliases for the project
  const { data: projectsData } = useGetPrimaryContentProjectsQuery();
  const selectedProject = projectsData?.projects.find((p) => p.id === projectId);
  const availableAliases = selectedProject?.aliases || [];

  const [domainType, setDomainType] = useState<'subdomain' | 'custom' | 'redirect'>('subdomain');
  const [subdomain, setSubdomain] = useState('');
  const [customDomain, setCustomDomain] = useState('');
  const [redirectTarget, setRedirectTarget] = useState('');
  const [alias, setAlias] = useState('');
  const [path, setPath] = useState('');
  const [sslEnabled, setSslEnabled] = useState(false);
  const [isSpa, setIsSpa] = useState(false);
  const [wwwBehavior, setWwwBehavior] = useState<WwwBehavior | 'none'>('none');

  // When SSL toggle is hidden (PaaS mode), default SSL to true
  useEffect(() => {
    if (!showSslToggle) {
      setSslEnabled(true);
    }
  }, [showSslToggle]);
  // Visibility: 'inherit' (null), 'public' (true), 'private' (false)
  const [visibility, setVisibility] = useState<'inherit' | 'public' | 'private'>('inherit');

  const [errors, setErrors] = useState<{
    domain?: string;
    path?: string;
    redirectTarget?: string;
  }>({});

  // Detect www/apex alternate domain for custom domains
  const alternateInfo = useMemo(() => {
    if (domainType !== 'custom' || !customDomain) return null;
    return getAlternateDomain(customDomain);
  }, [domainType, customDomain]);

  // Force custom/redirect domains to be public (cookies don't work cross-domain)
  // and disable SSL (must be requested after DNS verification)
  useEffect(() => {
    if (domainType === 'custom' || domainType === 'redirect') {
      setVisibility('public');
      setSslEnabled(false);
    }
    if (domainType === 'redirect') {
      setIsSpa(false);
    }
  }, [domainType]);

  const validateForm = (): boolean => {
    const newErrors: { domain?: string; path?: string; redirectTarget?: string } = {};

    const domainRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

    // Validate domain
    if (domainType === 'subdomain') {
      if (!subdomain) {
        newErrors.domain = 'Subdomain is required';
      } else if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(subdomain)) {
        newErrors.domain =
          'Subdomain must start and end with alphanumeric, can contain hyphens';
      }
    } else if (domainType === 'custom' || domainType === 'redirect') {
      if (!customDomain) {
        newErrors.domain = 'Domain is required';
      } else if (!domainRegex.test(customDomain)) {
        newErrors.domain = 'Invalid domain format';
      }
    }

    // Validate redirect target for redirect domains
    if (domainType === 'redirect') {
      if (!redirectTarget) {
        newErrors.redirectTarget = 'Redirect target is required';
      } else if (!domainRegex.test(redirectTarget)) {
        newErrors.redirectTarget = 'Invalid redirect target format';
      } else if (redirectTarget === customDomain) {
        newErrors.redirectTarget = 'Redirect target cannot be the same as the source domain';
      }
    }

    // Validate path if provided (not for redirect domains)
    if (domainType !== 'redirect' && path && !/^\/[a-zA-Z0-9/_-]*$/.test(path)) {
      newErrors.path = 'Path must start with / and contain only alphanumeric, /, _, -';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Convert visibility state to isPublic value
  const getIsPublicValue = (): boolean | null => {
    if (visibility === 'inherit') return null;
    if (visibility === 'public') return true;
    return false;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) return;

    const domain =
      domainType === 'subdomain' ? `${subdomain}.${baseDomain}` : customDomain;

    const dto: CreateDomainDto = {
      domain,
      domainType,
      sslEnabled,
      isPublic: getIsPublicValue(),
    };

    // Only include projectId for non-redirect domains
    if (domainType !== 'redirect') {
      dto.projectId = projectId;
      dto.alias = alias || undefined;
      dto.path = path || undefined;
      dto.isSpa = isSpa;
    }

    // Include redirect target for redirect domains
    if (domainType === 'redirect') {
      dto.redirectTarget = redirectTarget;
    }

    // Include wwwBehavior for custom domains if set
    if (domainType === 'custom' && wwwBehavior !== 'none') {
      dto.wwwBehavior = wwwBehavior;
    }

    onSubmit(dto);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 overflow-hidden">
      <div>
        <Label htmlFor="domainType">Domain Type</Label>
        {customDomainsEnabled ? (
          <Select
            value={domainType}
            onValueChange={(value) => setDomainType(value as 'subdomain' | 'custom' | 'redirect')}
          >
            <SelectTrigger id="domainType">
              <SelectValue placeholder="Select type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="subdomain">Subdomain (Recommended)</SelectItem>
              <SelectItem value="custom">Custom Domain</SelectItem>
              <SelectItem value="redirect">Redirect Domain</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <div className="flex h-10 w-full items-center rounded-md border border-input bg-muted px-3 py-2 text-sm">
            Subdomain
          </div>
        )}
        {domainType === 'redirect' && (
          <p className="text-xs text-muted-foreground mt-1">
            Redirect all traffic from this domain to another domain
          </p>
        )}
      </div>

      <div>
        <Label htmlFor="domain">
          {domainType === 'subdomain' ? 'Subdomain' : domainType === 'redirect' ? 'Source Domain' : 'Custom Domain'}
        </Label>
        <div className="flex items-center gap-2">
          {domainType === 'subdomain' ? (
            <>
              <Input
                id="domain"
                placeholder="coverage"
                value={subdomain}
                onChange={(e) => setSubdomain(e.target.value.toLowerCase())}
                className="min-w-0 flex-1"
              />
              <span className="text-sm text-muted-foreground whitespace-nowrap">
                .{baseDomain}
              </span>
            </>
          ) : (
            <Input
              id="domain"
              placeholder={domainType === 'redirect' ? 'old-brand.example.com' : 'docs.example.com'}
              value={customDomain}
              onChange={(e) => setCustomDomain(e.target.value.toLowerCase())}
              className="min-w-0"
            />
          )}
        </div>
        {errors.domain && (
          <p className="text-sm text-destructive mt-1">{errors.domain}</p>
        )}
      </div>

      {/* Redirect target - only for redirect domains */}
      {domainType === 'redirect' && (
        <div>
          <Label htmlFor="redirectTarget">Redirect Target</Label>
          <div className="flex items-center gap-2">
            <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
            <Input
              id="redirectTarget"
              placeholder="new-brand.example.com"
              value={redirectTarget}
              onChange={(e) => setRedirectTarget(e.target.value.toLowerCase())}
              className="min-w-0 flex-1"
            />
          </div>
          {errors.redirectTarget && (
            <p className="text-sm text-destructive mt-1">{errors.redirectTarget}</p>
          )}
          <p className="text-xs text-muted-foreground mt-1">
            All traffic to the source domain will redirect to this domain (301 permanent redirect)
          </p>
        </div>
      )}

      {/* www/apex behavior - only for custom domains with detected alternate */}
      {domainType === 'custom' && alternateInfo && (
        <div>
          <Label htmlFor="wwwBehavior">
            {alternateInfo.isWww ? 'Apex Domain Behavior' : 'www Subdomain Behavior'}
          </Label>
          <Select
            value={wwwBehavior}
            onValueChange={(value) => setWwwBehavior(value as WwwBehavior | 'none')}
          >
            <SelectTrigger id="wwwBehavior">
              <SelectValue placeholder="Select behavior" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Configure separately</SelectItem>
              <SelectItem value={alternateInfo.isWww ? 'redirect-to-www' : 'redirect-to-root'}>
                Redirect {alternateInfo.alternate} here (Recommended)
              </SelectItem>
              <SelectItem value={alternateInfo.isWww ? 'redirect-to-root' : 'redirect-to-www'}>
                Redirect here to {alternateInfo.alternate}
              </SelectItem>
              <SelectItem value="serve-both">Serve content on both</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1">
            {wwwBehavior === 'none' && `You can add ${alternateInfo.alternate} as a separate domain later`}
            {wwwBehavior === 'redirect-to-www' && `${alternateInfo.isWww ? alternateInfo.alternate : customDomain} will redirect to ${alternateInfo.isWww ? customDomain : alternateInfo.alternate}`}
            {wwwBehavior === 'redirect-to-root' && `${alternateInfo.isWww ? customDomain : alternateInfo.alternate} will redirect to ${alternateInfo.isWww ? alternateInfo.alternate : customDomain}`}
            {wwwBehavior === 'serve-both' && `Both ${customDomain} and ${alternateInfo.alternate} will serve the same content`}
          </p>
        </div>
      )}

      {/* Deployment alias - only for subdomain and custom domains */}
      {domainType !== 'redirect' && (
        <div>
          <Label htmlFor="alias">Deployment Alias (Optional)</Label>
          {availableAliases.length > 0 ? (
            <Select
              value={alias || undefined}
              onValueChange={(value) => setAlias(value === '__empty__' ? '' : value)}
            >
              <SelectTrigger id="alias">
                <SelectValue placeholder="Select an alias (uses 'latest' if empty)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__empty__">
                  <span className="text-muted-foreground">None (uses "latest")</span>
                </SelectItem>
                {availableAliases.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              id="alias"
              placeholder="production"
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
            />
          )}
          <p className="text-xs text-muted-foreground mt-1">
            e.g., production, staging, main. Uses "latest" alias if empty.
          </p>
        </div>
      )}

      {/* Path - only for subdomain and custom domains */}
      {domainType !== 'redirect' && (
        <div>
          <Label htmlFor="path">Path (Optional)</Label>
          <PathTypeahead
            id="path"
            owner={selectedProject?.owner || ''}
            repo={selectedProject?.name || ''}
            alias={alias}
            value={path}
            onChange={setPath}
            placeholder="/apps/frontend/coverage"
            disabled={!selectedProject}
          />
          {errors.path && (
            <p className="text-sm text-destructive mt-1">{errors.path}</p>
          )}
          <p className="text-xs text-muted-foreground mt-1">
            Subdirectory within the deployment
          </p>
        </div>
      )}

      {/* Visibility selector - only for subdomain and custom domains */}
      {domainType !== 'redirect' && (
        <div>
          <Label htmlFor="visibility">Visibility</Label>
          <Select
            value={visibility}
            onValueChange={(v) => setVisibility(v as 'inherit' | 'public' | 'private')}
            disabled={domainType === 'custom'}
          >
            <SelectTrigger id="visibility">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inherit">
                <div className="flex items-center gap-2">
                  <ArrowDown className="h-3 w-3" />
                  <span>Inherit from alias/project</span>
                </div>
              </SelectItem>
              <SelectItem value="public">
                <div className="flex items-center gap-2">
                  <Globe className="h-3 w-3" />
                  <span>Public</span>
                </div>
              </SelectItem>
              <SelectItem value="private" disabled={domainType === 'custom'}>
                <div className="flex items-center gap-2">
                  <Lock className="h-3 w-3" />
                  <span>Private</span>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
          {domainType === 'custom' && (
            <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              Custom domains must be public (authentication cookies don't work cross-domain)
            </p>
          )}
          {domainType === 'subdomain' && (
            <p className="text-xs text-muted-foreground mt-1">
              Choose visibility or inherit from the deployment alias or project settings
            </p>
          )}
        </div>
      )}

      {/* SPA Mode - only for subdomain and custom domains */}
      {domainType !== 'redirect' && (
        <div className="flex items-center gap-2">
          <Switch
            id="isSpa"
            checked={isSpa}
            onCheckedChange={setIsSpa}
          />
          <Label htmlFor="isSpa" className="flex flex-col">
            <span>SPA Mode</span>
            <span className="text-xs text-muted-foreground font-normal">
              Enable for React/Vue/Angular apps - 404s fallback to index.html
            </span>
          </Label>
        </div>
      )}

      {/* SSL toggle - only for subdomain domains when enabled */}
      {showSslToggle && domainType === 'subdomain' && (
        <div className="flex items-center gap-2">
          <Switch
            id="sslEnabled"
            checked={sslEnabled}
            onCheckedChange={setSslEnabled}
          />
          <Label htmlFor="sslEnabled" className="flex flex-col">
            <span>Enable SSL</span>
          </Label>
        </div>
      )}

      {/* SSL info for custom/redirect domains */}
      {showSslToggle && (domainType === 'custom' || domainType === 'redirect') && (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          SSL will be configured after DNS verification
        </p>
      )}

      <div className="flex justify-end gap-2 pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isLoading}>
          {isLoading ? 'Creating...' : 'Create Domain'}
        </Button>
      </div>
    </form>
  );
}