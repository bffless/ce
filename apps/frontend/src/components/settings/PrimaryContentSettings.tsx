import { useState, useEffect } from 'react';
import {
  useGetPrimaryContentQuery,
  useUpdatePrimaryContentMutation,
  useGetPrimaryContentProjectsQuery,
} from '@/services/settingsApi';
import { useGetDomainQuery } from '@/services/domainsApi';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { Globe, ExternalLink, Info, Loader2, Settings2 } from 'lucide-react';
import { EditDomainDialog } from '@/components/domains/EditDomainDialog';
import { PathTypeahead } from '@/components/domains/PathTypeahead';
import { useFeatureFlags } from '@/services/featureFlagsApi';

export function PrimaryContentSettings() {
  const { toast } = useToast();
  const { isEnabled } = useFeatureFlags();
  const showSslSettings = isEnabled('ENABLE_DOMAIN_SSL_TOGGLE');

  const {
    data: config,
    isLoading: isLoadingConfig,
    error: configError,
  } = useGetPrimaryContentQuery();

  const { data: projectsData, isLoading: isLoadingProjects } =
    useGetPrimaryContentProjectsQuery();

  // Fetch the domain mapping if we have a domainMappingId
  const { data: domainMapping, refetch: refetchDomain } = useGetDomainQuery(
    config?.domainMappingId || '',
    { skip: !config?.domainMappingId }
  );

  const [updatePrimaryContent, { isLoading: isUpdating }] =
    useUpdatePrimaryContentMutation();

  // Local form state
  const [enabled, setEnabled] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [alias, setAlias] = useState<string | null>(null);
  const [path, setPath] = useState('');
  const [wwwEnabled, setWwwEnabled] = useState(true);
  const [wwwBehavior, setWwwBehavior] = useState<
    'redirect-to-www' | 'redirect-to-root' | 'serve-both'
  >('redirect-to-www');
  const [isSpa, setIsSpa] = useState(false);

  // Track if form has changes
  const [hasChanges, setHasChanges] = useState(false);

  // Validation errors
  const [errors, setErrors] = useState<Record<string, string>>({});

  // State for the advanced settings dialog
  const [isAdvancedDialogOpen, setIsAdvancedDialogOpen] = useState(false);

  // Initialize form from config
  useEffect(() => {
    if (config) {
      setEnabled(config.enabled);
      setProjectId(config.projectId);
      setAlias(config.alias);
      setPath(config.path || '');
      setWwwEnabled(config.wwwEnabled ?? true);
      setWwwBehavior(config.wwwBehavior);
      setIsSpa(config.isSpa);
      setHasChanges(false);
    }
  }, [config]);

  // Get selected project's available aliases
  const selectedProject = projectsData?.projects.find((p) => p.id === projectId);
  const availableAliases = selectedProject?.aliases || [];

  // Reset alias when project changes
  useEffect(() => {
    if (projectId && selectedProject) {
      // If current alias not in new project's aliases, reset it
      if (alias && !selectedProject.aliases.includes(alias)) {
        setAlias(selectedProject.aliases[0] || null);
        setHasChanges(true);
      }
    }
  }, [projectId, selectedProject, alias]);

  // Build preview URL
  const baseDomain = window.location.hostname.replace(/^admin\./, '');
  const previewDomain =
    wwwEnabled && wwwBehavior !== 'redirect-to-root'
      ? `www.${baseDomain}`
      : baseDomain;
  const previewUrl =
    enabled && projectId && alias ? `https://${previewDomain}/` : null;

  const previewPath =
    enabled && projectId && alias && selectedProject
      ? `${selectedProject.owner}/${selectedProject.name} @ ${alias}${path ? path : ''}`
      : null;

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (enabled) {
      if (!projectId) {
        newErrors.projectId = 'Please select a repository';
      }
      if (!alias) {
        newErrors.alias = 'Please select an alias';
      }
      if (path && !path.startsWith('/')) {
        newErrors.path = 'Path must start with /';
      }
      if (path && path.includes('..')) {
        newErrors.path = 'Path cannot contain ..';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) {
      toast({
        title: 'Validation Error',
        description: 'Please fix the errors before saving',
        variant: 'destructive',
      });
      return;
    }

    try {
      const result = await updatePrimaryContent({
        enabled,
        projectId,
        alias,
        path: path || null,
        wwwEnabled,
        wwwBehavior,
        isSpa,
      }).unwrap();

      toast({
        title: 'Success',
        description: result.message,
      });
      setHasChanges(false);
      setErrors({});
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.data?.message || 'Failed to update primary content settings',
        variant: 'destructive',
      });
      console.error('Failed to update:', error);
    }
  };

  const handleCancel = () => {
    if (config) {
      setEnabled(config.enabled);
      setProjectId(config.projectId);
      setAlias(config.alias);
      setPath(config.path || '');
      setWwwEnabled(config.wwwEnabled ?? true);
      setWwwBehavior(config.wwwBehavior);
      setIsSpa(config.isSpa);
      setHasChanges(false);
      setErrors({});
    }
  };

  if (isLoadingConfig) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-96" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (configError) {
    return (
      <Card>
        <CardContent className="py-8">
          <Alert variant="destructive">
            <AlertDescription>
              Failed to load primary content settings
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Globe className="h-5 w-5" />
          <CardTitle>Primary Domain Content</CardTitle>
        </div>
        <CardDescription>
          Configure what visitors see when they visit your primary domain
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Enable toggle */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="primary-content-enabled">
              Enable primary domain content
            </Label>
            <p className="text-sm text-muted-foreground">
              When enabled, your primary domain will serve the selected
              deployment instead of redirecting to admin
            </p>
          </div>
          <Switch
            id="primary-content-enabled"
            checked={enabled}
            onCheckedChange={(checked) => {
              setEnabled(checked);
              setHasChanges(true);
            }}
          />
        </div>

        {/* Configuration options (shown when enabled or has project) */}
        {(enabled || projectId) && (
          <>
            <div className="border-t pt-6 space-y-4">
              {/* Repository selection */}
              <div className="space-y-2">
                <Label htmlFor="project-select">Repository</Label>
                <Select
                  value={projectId || undefined}
                  onValueChange={(value) => {
                    setProjectId(value);
                    setHasChanges(true);
                  }}
                  disabled={isLoadingProjects}
                >
                  <SelectTrigger id="project-select">
                    <SelectValue placeholder="Select a repository" />
                  </SelectTrigger>
                  <SelectContent>
                    {projectsData?.projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.owner}/{project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.projectId && (
                  <p className="text-sm text-destructive">{errors.projectId}</p>
                )}
              </div>

              {/* Alias selection */}
              <div className="space-y-2">
                <Label htmlFor="alias-select">Deployment Alias</Label>
                <Select
                  value={alias || undefined}
                  onValueChange={(value) => {
                    setAlias(value);
                    setHasChanges(true);
                  }}
                  disabled={!projectId || availableAliases.length === 0}
                >
                  <SelectTrigger id="alias-select">
                    <SelectValue placeholder="Select an alias" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableAliases.map((a) => (
                      <SelectItem key={a} value={a}>
                        {a}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {projectId && availableAliases.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No aliases found. Deploy content with an alias first.
                  </p>
                )}
                {errors.alias && (
                  <p className="text-sm text-destructive">{errors.alias}</p>
                )}
              </div>

              {/* Path input */}
              <div className="space-y-2">
                <Label htmlFor="path-input">
                  Path <span className="text-muted-foreground">(optional)</span>
                </Label>
                <PathTypeahead
                  id="path-input"
                  owner={selectedProject?.owner || ''}
                  repo={selectedProject?.name || ''}
                  alias={alias || ''}
                  value={path}
                  onChange={(newPath) => {
                    setPath(newPath);
                    setHasChanges(true);
                  }}
                  placeholder="/dist or leave empty for root"
                  disabled={!selectedProject || !alias}
                />
                <p className="text-sm text-muted-foreground">
                  Subdirectory within the deployment to serve
                </p>
                {errors.path && (
                  <p className="text-sm text-destructive">{errors.path}</p>
                )}
              </div>

              {/* WWW subdomain toggle */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="www-enabled">Add www subdomain</Label>
                    <p className="text-sm text-muted-foreground">
                      Enable to support both {baseDomain} and www.{baseDomain}
                    </p>
                  </div>
                  <Switch
                    id="www-enabled"
                    checked={wwwEnabled}
                    onCheckedChange={(checked) => {
                      setWwwEnabled(checked);
                      setHasChanges(true);
                    }}
                  />
                </div>

                {/* WWW behavior options - shown only when www is enabled */}
                {wwwEnabled && (
                  <div className="ml-4 pl-4 border-l space-y-3">
                    <Label className="text-sm font-medium">Redirect behavior</Label>
                    <RadioGroup
                      value={wwwBehavior}
                      onValueChange={(value: typeof wwwBehavior) => {
                        setWwwBehavior(value);
                        setHasChanges(true);
                      }}
                      className="space-y-2"
                    >
                      <div className="flex items-start space-x-3">
                        <RadioGroupItem value="redirect-to-www" id="redirect-to-www" className="mt-0.5" />
                        <div className="space-y-0.5">
                          <Label htmlFor="redirect-to-www" className="font-normal cursor-pointer">
                            Redirect to www
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            {baseDomain} redirects to www.{baseDomain}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start space-x-3">
                        <RadioGroupItem value="redirect-to-root" id="redirect-to-root" className="mt-0.5" />
                        <div className="space-y-0.5">
                          <Label htmlFor="redirect-to-root" className="font-normal cursor-pointer">
                            Redirect to root
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            www.{baseDomain} redirects to {baseDomain}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start space-x-3">
                        <RadioGroupItem value="serve-both" id="serve-both" className="mt-0.5" />
                        <div className="space-y-0.5">
                          <Label htmlFor="serve-both" className="font-normal cursor-pointer">
                            Serve both
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            Both domains serve content (no redirect)
                          </p>
                        </div>
                      </div>
                    </RadioGroup>
                  </div>
                )}
              </div>

              {/* SPA Mode toggle */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="spa-mode">Single Page Application (SPA)</Label>
                  <p className="text-sm text-muted-foreground">
                    Enable for React, Vue, or Angular apps with client-side routing.
                    Non-existent paths will serve index.html instead of showing 404.
                  </p>
                </div>
                <Switch
                  id="spa-mode"
                  checked={isSpa}
                  onCheckedChange={(checked) => {
                    setIsSpa(checked);
                    setHasChanges(true);
                  }}
                />
              </div>
            </div>

            {/* Preview */}
            {previewUrl && previewPath && (
              <div className="border rounded-lg p-4 bg-muted/50">
                <div className="flex items-center gap-2 mb-2">
                  <Info className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">Preview</span>
                </div>
                <div className="space-y-1 text-sm">
                  <p>
                    <span className="text-muted-foreground">Visitors to </span>
                    <a
                      href={previewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline inline-flex items-center gap-1"
                    >
                      {previewUrl}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </p>
                  <p>
                    <span className="text-muted-foreground">will see: </span>
                    <span className="font-mono">{previewPath}</span>
                  </p>
                </div>
              </div>
            )}

            {/* Advanced Settings Button - shown when domain mapping exists */}
            {config?.domainMappingId && domainMapping && (
              <div className="pt-4 border-t">
                <Button
                  variant="outline"
                  onClick={() => setIsAdvancedDialogOpen(true)}
                  className="w-full"
                >
                  <Settings2 className="mr-2 h-4 w-4" />
                  {showSslSettings
                    ? 'Advanced Settings (SSL, Redirects, Traffic)'
                    : 'Advanced Settings (Redirects, Traffic)'}
                </Button>
                <p className="text-xs text-muted-foreground mt-2 text-center">
                  {showSslSettings
                    ? 'Configure SSL certificates, domain redirects, and traffic routing'
                    : 'Configure domain redirects and traffic routing'}
                </p>
              </div>
            )}
          </>
        )}

        {/* Info when disabled */}
        {!enabled && !projectId && (
          <Alert className="[&>svg]:top-1/2 [&>svg]:-translate-y-1/2">
            <Info className="h-4 w-4" />
            <AlertDescription>
              When disabled, visitors to your primary domain will be redirected
              to the admin panel at admin.{baseDomain}
            </AlertDescription>
          </Alert>
        )}

        {/* Actions */}
        {hasChanges && (
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isUpdating}>
              {isUpdating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </div>
        )}
      </CardContent>

      {/* Advanced Settings Dialog - uses the same modal as Domain Mappings */}
      {domainMapping && (
        <EditDomainDialog
          domain={domainMapping}
          open={isAdvancedDialogOpen}
          onOpenChange={(open) => {
            setIsAdvancedDialogOpen(open);
            // Refetch domain data when dialog closes to get any changes
            if (!open) {
              refetchDomain();
            }
          }}
        />
      )}
    </Card>
  );
}