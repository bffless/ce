import { useState } from 'react';
import {
  useListDomainsQuery,
  useCreateDomainMutation,
  useDeleteDomainMutation,
  useGetDomainsConfigQuery,
  type DomainMapping,
  type CreateDomainDto,
} from '@/services/domainsApi';
import { useListUserProjectsQuery } from '@/services/projectsApi';
import { useFeatureFlags } from '@/services/featureFlagsApi';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import {
  setSearchQuery,
  setFilterType,
  setFilterStatus,
  resetFilters,
} from '@/store/slices/domainsSlice';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { DomainCard } from '@/components/domains/DomainCard';
import { DomainForm } from '@/components/domains/DomainForm';
import { SslCertificatePanel } from '@/components/domains/SslCertificatePanel';
import { EditDomainDialog } from '@/components/domains/EditDomainDialog';
import { Plus, Search, X, AlertCircle, Info, Copy, Check, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export function DomainsPage() {
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const { searchQuery, filterType, filterStatus } = useAppSelector(
    (state) => state.domains
  );

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [domainToDelete, setDomainToDelete] = useState<DomainMapping | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [editingDomain, setEditingDomain] = useState<DomainMapping | null>(null);

  // Fetch domains, projects, and config
  const { data: domains, isLoading, error, refetch } = useListDomainsQuery({});
  const { data: projects, isLoading: projectsLoading } = useListUserProjectsQuery();
  const { data: config } = useGetDomainsConfigQuery();

  // Feature flags
  const { isEnabled, getValue } = useFeatureFlags();
  const proxyMode = getValue<string>('PROXY_MODE', 'none');
  const isExternalProxyMode = proxyMode === 'cloudflare-tunnel' || proxyMode === 'cloudflare';
  const sslToggleEnabled = isEnabled('ENABLE_DOMAIN_SSL_TOGGLE');
  const isPlatformMode = !sslToggleEnabled;
  // Hide DNS instructions when external proxy (Cloudflare) or platform (Traefik) handles DNS/SSL
  // Only show when self-hosted with Let's Encrypt (PROXY_MODE=none, not in platform mode)
  const showDnsInstructions = isEnabled('ENABLE_DNS_SETUP_INSTRUCTIONS') && !isExternalProxyMode && !isPlatformMode;

  const [createDomain, { isLoading: isCreating }] = useCreateDomainMutation();
  const [deleteDomain, { isLoading: isDeleting }] = useDeleteDomainMutation();

  // Filter domains
  const filteredDomains = domains?.filter((domain) => {
    const matchesSearch = domain.domain
      .toLowerCase()
      .includes(searchQuery.toLowerCase());
    const matchesType = filterType === 'all' || domain.domainType === filterType;
    const matchesStatus =
      filterStatus === 'all' ||
      (filterStatus === 'active' && domain.isActive) ||
      (filterStatus === 'inactive' && !domain.isActive);

    return matchesSearch && matchesType && matchesStatus;
  });

  const handleCreate = async (data: CreateDomainDto) => {
    try {
      await createDomain(data).unwrap();
      toast({
        title: 'Domain created',
        description: `Successfully created domain mapping for ${data.domain}`,
      });
      setIsFormOpen(false);
      setSelectedProjectId('');
    } catch (err: unknown) {
      const errorMessage =
        (err as { data?: { message?: string } })?.data?.message ||
        'Failed to create domain';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async () => {
    if (!domainToDelete) return;

    try {
      await deleteDomain(domainToDelete.id).unwrap();
      toast({
        title: 'Domain deleted',
        description: `Successfully deleted domain mapping for ${domainToDelete.domain}`,
      });
      setDomainToDelete(null);
    } catch (err: unknown) {
      const errorMessage =
        (err as { data?: { message?: string } })?.data?.message ||
        'Failed to delete domain';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  const handleEdit = (domain: DomainMapping) => {
    setEditingDomain(domain);
  };

  const openCreateDialog = () => {
    if (!projects || projects.length === 0) {
      toast({
        title: 'No projects',
        description: 'Create a project first before adding domain mappings',
        variant: 'destructive',
      });
      return;
    }
    setIsFormOpen(true);
  };

  const hasFilters = searchQuery || filterType !== 'all' || filterStatus !== 'all';

  const copyToClipboard = async (text: string, field: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  if (error) {
    return (
      <div className="container mx-auto py-8">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Error loading domains.{' '}
            <Button variant="link" className="p-0 h-auto" onClick={() => refetch()}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">Domain Mappings</h1>
          <p className="text-muted-foreground mt-1">
            Manage custom domain mappings for your deployments
          </p>
        </div>
        <Button onClick={openCreateDialog}>
          <Plus className="h-4 w-4 mr-2" />
          New Domain
        </Button>
      </div>

      {/* SSL Certificate Management */}
      <div className="mb-8">
        <SslCertificatePanel />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 mb-6">
        <div className="flex-1 min-w-[200px] relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search domains..."
            value={searchQuery}
            onChange={(e) => dispatch(setSearchQuery(e.target.value))}
            className="pl-10"
          />
        </div>

        <Select
          value={filterType}
          onValueChange={(value) =>
            dispatch(setFilterType(value as 'all' | 'subdomain' | 'custom'))
          }
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="subdomain">Subdomain</SelectItem>
            <SelectItem value="custom">Custom</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filterStatus}
          onValueChange={(value) =>
            dispatch(setFilterStatus(value as 'all' | 'active' | 'inactive'))
          }
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={() => dispatch(resetFilters())}>
            <X className="h-4 w-4 mr-1" />
            Clear Filters
          </Button>
        )}
      </div>

      {/* Domain List */}
      {isLoading ? (
        <div className="grid gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
      ) : filteredDomains && filteredDomains.length > 0 ? (
        <div className="grid gap-4">
          {filteredDomains.map((domain) => (
            <DomainCard
              key={domain.id}
              domain={domain}
              onEdit={handleEdit}
              onDelete={(id) => {
                const d = domains?.find((dom) => dom.id === id);
                if (d) setDomainToDelete(d);
              }}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-12 text-muted-foreground">
          {hasFilters ? (
            <>
              <p>No domains match your filters</p>
              <Button
                variant="link"
                className="mt-2"
                onClick={() => dispatch(resetFilters())}
              >
                Clear filters
              </Button>
            </>
          ) : (
            <>
              <p>No domain mappings yet</p>
              <Button variant="link" className="mt-2" onClick={openCreateDialog}>
                Create your first domain mapping
              </Button>
            </>
          )}
        </div>
      )}

      {/* DNS Setup Instructions */}
      {showDnsInstructions && config?.baseDomain && (
        <Card className="mt-8">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Info className="h-5 w-5 text-blue-500" />
              <CardTitle className="text-lg">DNS Setup Instructions</CardTitle>
            </div>
            <CardDescription>
              Configure your DNS to enable subdomain mappings
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              To use subdomain mappings (e.g., <code className="bg-muted px-1 py-0.5 rounded">coverage.{config.baseDomain}</code>),
              you need to add a wildcard DNS record pointing to your server.
            </p>

            <div className="bg-muted rounded-lg p-4 space-y-3">
              <h4 className="font-medium text-sm">Add this DNS record at your domain registrar:</h4>

              <div className="grid grid-cols-[80px_1fr] gap-2 text-sm">
                <span className="text-muted-foreground">Type:</span>
                <span className="font-mono">A</span>

                <span className="text-muted-foreground">Host:</span>
                <div className="flex items-center gap-2">
                  <code className="bg-background px-2 py-1 rounded border font-mono">*</code>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => copyToClipboard('*', 'host')}
                  >
                    {copiedField === 'host' ? (
                      <Check className="h-3.5 w-3.5 text-green-500" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>

                <span className="text-muted-foreground">Value:</span>
                <div className="flex items-center gap-2">
                  <code className="bg-background px-2 py-1 rounded border font-mono">[Your Server IP]</code>
                </div>

                <span className="text-muted-foreground">TTL:</span>
                <span className="font-mono">Automatic (or 300)</span>
              </div>
            </div>

            <div className="text-sm space-y-2">
              <p className="text-muted-foreground">
                <strong>Note:</strong> The wildcard record (<code className="bg-muted px-1 py-0.5 rounded">*</code>) will route
                all subdomains to your server. This is required for dynamic subdomain mappings to work.
              </p>
              <p className="text-muted-foreground">
                DNS changes can take up to 24 hours to propagate, though they usually complete within 15-30 minutes.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Create Domain Dialog */}
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="max-w-md overflow-hidden">
          <DialogHeader>
            <DialogTitle>Create Domain Mapping</DialogTitle>
            <DialogDescription>
              Map a custom domain or subdomain to your deployment
            </DialogDescription>
          </DialogHeader>

          {/* Project selector */}
          {!selectedProjectId ? (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Select Project</label>
                {projectsLoading ? (
                  <Skeleton className="h-10 w-full mt-2" />
                ) : (
                  <Select onValueChange={(value) => setSelectedProjectId(value)}>
                    <SelectTrigger className="mt-2">
                      <SelectValue placeholder="Choose a project" />
                    </SelectTrigger>
                    <SelectContent>
                      {projects?.map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          {project.owner}/{project.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
          ) : (
            <DomainForm
              projectId={selectedProjectId}
              baseDomain={config?.baseDomain}
              onSubmit={handleCreate}
              onCancel={() => {
                setIsFormOpen(false);
                setSelectedProjectId('');
              }}
              isLoading={isCreating}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Domain Dialog */}
      <EditDomainDialog
        domain={editingDomain}
        open={!!editingDomain}
        onOpenChange={(open) => !open && setEditingDomain(null)}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!domainToDelete}
        onOpenChange={(open) => !open && setDomainToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Domain Mapping</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the domain mapping for{' '}
              <strong>{domainToDelete?.domain}</strong>? This action cannot be undone
              and the domain will no longer resolve to your deployment.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}