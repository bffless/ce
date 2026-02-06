import { useState, useEffect } from 'react';
import {
  useUpdateDomainMutation,
  useGetDomainVisibilityQuery,
  type DomainMapping,
  type UpdateDomainDto,
  type UnauthorizedBehavior,
  type RequiredRole,
  type WwwBehavior,
} from '@/services/domainsApi';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { Globe, Lock, ArrowDown, AlertCircle, Shield } from 'lucide-react';
import { RedirectsTab } from './RedirectsTab';
import { SslTab } from './SslTab';
import { TrafficTab } from './TrafficTab';
import { DomainShareLinksSection } from './DomainShareLinksSection';
import { useFeatureFlags } from '@/services/featureFlagsApi';

interface EditDomainDialogProps {
  domain: DomainMapping | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Helper to get alternate domain (www <-> apex)
function getAlternateInfo(domain: string): { alternate: string; isWww: boolean } | null {
  if (domain.startsWith('www.')) {
    return { alternate: domain.slice(4), isWww: true };
  }
  // Check if it's an apex domain (no subdomain other than potential www)
  const parts = domain.split('.');
  if (parts.length === 2 || (parts.length === 3 && ['co', 'com', 'org', 'net'].includes(parts[parts.length - 2]))) {
    return { alternate: `www.${domain}`, isWww: false };
  }
  return null;
}

export function EditDomainDialog({ domain, open, onOpenChange }: EditDomainDialogProps) {
  const { toast } = useToast();
  const [updateDomain, { isLoading }] = useUpdateDomainMutation();
  const { isEnabled } = useFeatureFlags();
  const showSslTab = isEnabled('ENABLE_DOMAIN_SSL_TOGGLE');

  // Phase B5: Get visibility info for display
  const { data: visibilityInfo } = useGetDomainVisibilityQuery(domain?.id || '', {
    skip: !domain,
  });

  // Form state
  const [alias, setAlias] = useState('');
  const [path, setPath] = useState('');
  const [isActive, setIsActive] = useState(true);
  // Phase B5: Visibility state - 'inherit' | 'public' | 'private'
  const [visibility, setVisibility] = useState<'inherit' | 'public' | 'private'>('inherit');
  // Access control overrides ('inherit' means null)
  const [unauthorizedBehavior, setUnauthorizedBehavior] = useState<'inherit' | UnauthorizedBehavior>('inherit');
  const [requiredRole, setRequiredRole] = useState<'inherit' | RequiredRole>('inherit');
  // SPA mode
  const [isSpa, setIsSpa] = useState(false);
  // WWW behavior for custom domains
  const [wwwBehavior, setWwwBehavior] = useState<WwwBehavior | 'none'>('none');

  // Reset form when domain changes
  useEffect(() => {
    if (domain) {
      setAlias(domain.alias || '');
      setPath(domain.path || '');
      setIsActive(domain.isActive);
      setIsSpa(domain.isSpa ?? false);
      // Convert isPublic to visibility state
      // Custom domains (except primary) must always be public - cookies don't work cross-domain
      // Primary domains can be private since they're on the same base domain
      const forcePublic = domain.domainType === 'custom' && !domain.isPrimary;
      if (forcePublic) {
        setVisibility('public');
      } else if (domain.isPublic === null || domain.isPublic === undefined) {
        setVisibility('inherit');
      } else if (domain.isPublic === true) {
        setVisibility('public');
      } else {
        setVisibility('private');
      }
      // Initialize access control overrides
      setUnauthorizedBehavior(domain.unauthorizedBehavior ?? 'inherit');
      setRequiredRole(domain.requiredRole ?? 'inherit');
      // Initialize wwwBehavior
      setWwwBehavior(domain.wwwBehavior ?? 'none');
    }
  }, [domain]);

  // Convert visibility state to isPublic value
  const getIsPublicValue = (): boolean | null | undefined => {
    if (visibility === 'inherit') return null;
    if (visibility === 'public') return true;
    return false;
  };

  // Get the original isPublic value for comparison
  const getOriginalIsPublic = (): boolean | null | undefined => {
    if (domain?.isPublic === null || domain?.isPublic === undefined) return null;
    return domain.isPublic;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!domain) return;

    const updates: UpdateDomainDto = {};

    // Only include changed fields
    if (alias !== (domain.alias || '')) updates.alias = alias || undefined;
    if (path !== (domain.path || '')) updates.path = path || undefined;
    if (isActive !== domain.isActive) updates.isActive = isActive;

    // Phase B5: Check if visibility changed
    const newIsPublic = getIsPublicValue();
    const originalIsPublic = getOriginalIsPublic();
    if (newIsPublic !== originalIsPublic) {
      updates.isPublic = newIsPublic;
    }

    // Check if access control overrides changed
    const newUnauthorizedBehavior = unauthorizedBehavior === 'inherit' ? null : unauthorizedBehavior;
    const originalUnauthorizedBehavior = domain.unauthorizedBehavior ?? null;
    if (newUnauthorizedBehavior !== originalUnauthorizedBehavior) {
      updates.unauthorizedBehavior = newUnauthorizedBehavior;
    }

    const newRequiredRole = requiredRole === 'inherit' ? null : requiredRole;
    const originalRequiredRole = domain.requiredRole ?? null;
    if (newRequiredRole !== originalRequiredRole) {
      updates.requiredRole = newRequiredRole;
    }

    // Check if SPA mode changed
    if (isSpa !== (domain.isSpa ?? false)) {
      updates.isSpa = isSpa;
    }

    // Check if wwwBehavior changed (only for custom domains)
    if (domain.domainType === 'custom') {
      const newWwwBehavior = wwwBehavior === 'none' ? null : wwwBehavior;
      const originalWwwBehavior = domain.wwwBehavior ?? null;
      if (newWwwBehavior !== originalWwwBehavior) {
        updates.wwwBehavior = newWwwBehavior;
      }
    }

    // Check if there are any changes
    if (Object.keys(updates).length === 0) {
      toast({
        title: 'No changes',
        description: 'No changes were made to the domain mapping.',
      });
      onOpenChange(false);
      return;
    }

    try {
      await updateDomain({ id: domain.id, updates }).unwrap();
      toast({
        title: 'Domain updated',
        description: `Successfully updated ${domain.domain}`,
      });
      onOpenChange(false);
    } catch (err: unknown) {
      const errorMessage =
        (err as { data?: { message?: string } })?.data?.message ||
        'Failed to update domain';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  if (!domain) return null;

  // Custom domains (except primary) must be public - cookies don't work cross-domain
  // Primary domains and subdomains can be private since they share the same base domain
  const isCustomNonPrimary = domain.domainType === 'custom' && !domain.isPrimary;

  // For redirect domains, hide most tabs as they only need general settings and SSL
  const isRedirectDomain = domain.domainType === 'redirect';

  // Calculate grid class for tab count - must use static class names for Tailwind
  const getTabGridClass = () => {
    if (isRedirectDomain) {
      return showSslTab ? 'grid-cols-2' : 'grid-cols-1';
    }
    return showSslTab ? 'grid-cols-5' : 'grid-cols-4';
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Domain Mapping</DialogTitle>
          <DialogDescription>
            Update settings for <strong>{domain.domain}</strong>
            {isRedirectDomain && domain.redirectTarget && (
              <span className="block text-xs mt-1">
                Redirects to: {domain.redirectTarget}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="general" className="w-full">
          <TabsList className={`grid w-full ${getTabGridClass()}`}>
            <TabsTrigger value="general">General</TabsTrigger>
            {showSslTab && <TabsTrigger value="ssl">SSL</TabsTrigger>}
            {!isRedirectDomain && <TabsTrigger value="redirects">Redirects</TabsTrigger>}
            {!isRedirectDomain && <TabsTrigger value="traffic">Traffic</TabsTrigger>}
            {!isRedirectDomain && <TabsTrigger value="share-links">Share Links</TabsTrigger>}
          </TabsList>

          <TabsContent value="general" className="mt-4">
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Redirect domain info */}
              {isRedirectDomain && (
                <div className="p-3 bg-muted rounded-md">
                  <p className="text-sm font-medium">Redirect Domain</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    All traffic to this domain is redirected to {domain.redirectTarget}
                  </p>
                </div>
              )}

              {/* Alias input - only for non-redirect domains */}
              {!isRedirectDomain && (
                <div className="space-y-2">
                  <Label htmlFor="alias">Deployment Alias (Optional)</Label>
                  <Input
                    id="alias"
                    value={alias}
                    onChange={(e) => setAlias(e.target.value)}
                    placeholder="production"
                  />
                  <p className="text-xs text-muted-foreground">
                    e.g., production, staging, main. Uses "latest" alias if empty.
                  </p>
                </div>
              )}

              {/* Path input - only for non-redirect domains */}
              {!isRedirectDomain && (
                <div className="space-y-2">
                  <Label htmlFor="path">Path (optional)</Label>
                  <Input
                    id="path"
                    value={path}
                    onChange={(e) => setPath(e.target.value)}
                    placeholder="/apps/frontend/coverage"
                  />
                  <p className="text-xs text-muted-foreground">
                    Subdirectory within the deployment to serve
                  </p>
                </div>
              )}

              {/* WWW Behavior - only for custom domains */}
              {domain.domainType === 'custom' && (() => {
                const alternateInfo = getAlternateInfo(domain.domain);
                if (!alternateInfo) return null;
                return (
                  <div className="space-y-2">
                    <Label htmlFor="wwwBehavior">
                      WWW / Apex Redirect
                    </Label>
                    <Select
                      value={wwwBehavior}
                      onValueChange={(v) => setWwwBehavior(v as WwwBehavior | 'none')}
                    >
                      <SelectTrigger id="wwwBehavior">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No redirect configured</SelectItem>
                        <SelectItem value="redirect-to-www">
                          Redirect {alternateInfo.isWww ? alternateInfo.alternate : domain.domain} → {alternateInfo.isWww ? domain.domain : alternateInfo.alternate}
                        </SelectItem>
                        <SelectItem value="redirect-to-root">
                          Redirect {alternateInfo.isWww ? domain.domain : alternateInfo.alternate} → {alternateInfo.isWww ? alternateInfo.alternate : domain.domain}
                        </SelectItem>
                        <SelectItem value="serve-both">Serve both (no redirect)</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Configure how to handle {alternateInfo.alternate}
                    </p>
                  </div>
                );
              })()}

              {/* Phase B5: Visibility control - only for non-redirect domains */}
              {!isRedirectDomain && (
                <div className="space-y-2">
                  <Label htmlFor="visibility">Visibility</Label>
                  <Select
                    value={visibility}
                    onValueChange={(v) => setVisibility(v as 'inherit' | 'public' | 'private')}
                    disabled={isCustomNonPrimary}
                  >
                    <SelectTrigger id="visibility">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="inherit" disabled={isCustomNonPrimary}>
                        <div className="flex items-center gap-2">
                          <ArrowDown className="h-3 w-3" />
                          <span>Inherit from {domain.alias ? 'alias' : 'project'}</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="public">
                        <div className="flex items-center gap-2">
                          <Globe className="h-3 w-3" />
                          <span>Public</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="private" disabled={isCustomNonPrimary}>
                        <div className="flex items-center gap-2">
                          <Lock className="h-3 w-3" />
                          <span>Private</span>
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {isCustomNonPrimary && (
                    <p className="text-xs text-amber-600 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      Custom domains must be public (authentication cookies don't work cross-domain)
                    </p>
                  )}
                  {!isCustomNonPrimary && visibilityInfo && visibility === 'inherit' && (
                    <p className="text-xs text-muted-foreground">
                      Currently inherits "{visibilityInfo.effectiveVisibility}" from {visibilityInfo.source}
                    </p>
                  )}
                </div>
              )}

              {/* Access Control Overrides - Only show when private and not redirect domain */}
              {!isRedirectDomain && visibility === 'private' && !isCustomNonPrimary && (
                <div className="space-y-4 p-3 rounded-md bg-muted/50 border">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Shield className="h-4 w-4" />
                    Access Control Overrides
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="unauthorizedBehavior">Unauthorized Behavior</Label>
                    <Select
                      value={unauthorizedBehavior}
                      onValueChange={(v) => setUnauthorizedBehavior(v as 'inherit' | UnauthorizedBehavior)}
                    >
                      <SelectTrigger id="unauthorizedBehavior">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="inherit">
                          <div className="flex items-center gap-2">
                            <ArrowDown className="h-3 w-3" />
                            <span>Inherit from {domain.alias ? 'alias' : 'project'}</span>
                          </div>
                        </SelectItem>
                        <SelectItem value="not_found">Show 404 (Not Found)</SelectItem>
                        <SelectItem value="redirect_login">Redirect to Login</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {unauthorizedBehavior === 'inherit' && visibilityInfo?.effectiveUnauthorizedBehavior
                        ? `Inherits "${visibilityInfo.effectiveUnauthorizedBehavior}" from ${visibilityInfo.source}`
                        : 'How to handle unauthenticated users'}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="requiredRole">Required Role</Label>
                    <Select
                      value={requiredRole}
                      onValueChange={(v) => setRequiredRole(v as 'inherit' | RequiredRole)}
                    >
                      <SelectTrigger id="requiredRole">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="inherit">
                          <div className="flex items-center gap-2">
                            <ArrowDown className="h-3 w-3" />
                            <span>Inherit from {domain.alias ? 'alias' : 'project'}</span>
                          </div>
                        </SelectItem>
                        <SelectItem value="authenticated">Any authenticated user</SelectItem>
                        <SelectItem value="viewer">Viewer or higher</SelectItem>
                        <SelectItem value="contributor">Contributor or higher</SelectItem>
                        <SelectItem value="admin">Admin or higher</SelectItem>
                        <SelectItem value="owner">Owner only</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {requiredRole === 'inherit' && visibilityInfo?.effectiveRequiredRole
                        ? `Inherits "${visibilityInfo.effectiveRequiredRole}" from ${visibilityInfo.source}`
                        : 'Minimum role required for access'}
                    </p>
                  </div>
                </div>
              )}

              {/* Active toggle */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="active">Active</Label>
                  <p className="text-xs text-muted-foreground">
                    Enable or disable this domain mapping
                  </p>
                </div>
                <Switch
                  id="active"
                  checked={isActive}
                  onCheckedChange={setIsActive}
                />
              </div>

              {/* SPA mode toggle - only for non-redirect domains */}
              {!isRedirectDomain && (
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="spa">Single Page Application (SPA)</Label>
                    <p className="text-xs text-muted-foreground">
                      Enable for React, Vue, or Angular apps with client-side routing.
                      Non-existent paths will serve index.html instead of 404.
                    </p>
                  </div>
                  <Switch
                    id="spa"
                    checked={isSpa}
                    onCheckedChange={setIsSpa}
                  />
                </div>
              )}

              <div className="flex justify-end gap-2 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isLoading}>
                  {isLoading ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </form>
          </TabsContent>

          {showSslTab && (
            <TabsContent value="ssl" className="mt-4">
              <SslTab
                domainId={domain.id}
                domain={domain.domain}
                domainType={domain.domainType}
              />
            </TabsContent>
          )}

          <TabsContent value="redirects" className="mt-4">
            <RedirectsTab domainId={domain.id} targetDomain={domain.domain} />
          </TabsContent>

          <TabsContent value="traffic" className="mt-4">
            <TrafficTab domainId={domain.id} domain={domain.domain} />
          </TabsContent>

          {!isRedirectDomain && (
            <TabsContent value="share-links" className="mt-4">
              <DomainShareLinksSection domainId={domain.id} domain={domain.domain} wwwBehavior={domain.wwwBehavior} />
            </TabsContent>
          )}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
