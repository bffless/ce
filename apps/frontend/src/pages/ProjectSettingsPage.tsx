import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useGetProjectQuery, useUpdateProjectMutation } from '@/services/projectsApi';
import { useGetSessionQuery } from '@/services/authApi';
import { useGetProjectPermissionsQuery } from '@/services/permissionsApi';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AlertCircle, ArrowLeft, Save, Lock, Shield, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { DeleteProjectDialog } from '@/components/project/DeleteProjectDialog';
import { ProjectMembersTab } from '@/components/project/ProjectMembersTab';
import { ProjectGroupsTab } from '@/components/project/ProjectGroupsTab';
import { ProjectApiKeysTab } from '@/components/project/ProjectApiKeysTab';
import { ProjectProxyRulesTab } from '@/components/project/ProjectProxyRulesTab';
import { ProjectStorageRetentionTab } from '@/components/project/ProjectStorageRetentionTab';
import { ProjectCacheRulesTab } from '@/components/project/ProjectCacheRulesTab';
import { ProjectShareLinksTab } from '@/components/project/ProjectShareLinksTab';
import { RepoBreadcrumb } from '@/components/repo/RepoBreadcrumb';

type TabValue = 'general' | 'members' | 'groups' | 'api-keys' | 'proxy-rules' | 'storage' | 'cache-rules' | 'share-links';

/**
 * ProjectSettingsPage - Project settings and permissions management
 * Route: /repo/:owner/:repo/settings
 */
export function ProjectSettingsPage() {
  const { owner, repo } = useParams<{
    owner: string;
    repo: string;
  }>();

  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();

  // Get tab from query params, default to 'general'
  const tabParam = searchParams.get('tab');
  const currentTab: TabValue =
    tabParam === 'members' || tabParam === 'groups' || tabParam === 'api-keys' || tabParam === 'proxy-rules' || tabParam === 'storage' || tabParam === 'cache-rules' || tabParam === 'share-links'
      ? tabParam
      : 'general';

  // Handler for tab changes
  const handleTabChange = (value: string) => {
    const newTab = value as TabValue;
    navigate(`/repo/${owner}/${repo}/settings?tab=${newTab}`, { replace: true });
  };

  // Check authentication status
  const { data: sessionData, isLoading: isLoadingSession } = useGetSessionQuery();
  const isAuthenticated = Boolean(sessionData?.user);
  const currentUser = sessionData?.user;

  // Fetch project details
  const {
    data: project,
    isLoading: isLoadingProject,
    error: projectError,
  } = useGetProjectQuery(
    {
      owner: owner!,
      name: repo!,
    },
    {
      skip: !owner || !repo,
    },
  );

  // Fetch permissions to check if user has admin+ role
  const {
    data: permissions,
    isLoading: isLoadingPermissions,
    error: permissionsError,
  } = useGetProjectPermissionsQuery(
    {
      owner: owner!,
      repo: repo!,
    },
    {
      skip: !owner || !repo || !isAuthenticated || !currentUser,
    },
  );

  // Check if current user has admin or owner role
  const userPermission = permissions?.userPermissions.find(
    (perm) => perm.userId === currentUser?.id,
  );
  const hasAdminAccess = userPermission
    ? ['owner', 'admin'].includes(userPermission.role)
    : false;
  const hasOwnerAccess = userPermission?.role === 'owner';

  const isLoading = isLoadingSession || isLoadingProject || isLoadingPermissions;
  const error = projectError || permissionsError;

  // Update project mutation
  const [updateProject, { isLoading: isUpdating }] = useUpdateProjectMutation();

  // Form state
  const [isPublic, setIsPublic] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [unauthorizedBehavior, setUnauthorizedBehavior] = useState<'not_found' | 'redirect_login'>('not_found');
  const [requiredRole, setRequiredRole] = useState<'authenticated' | 'viewer' | 'contributor' | 'admin' | 'owner'>('authenticated');
  const [hasChanges, setHasChanges] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Initialize form state when project data loads
  useEffect(() => {
    if (project) {
      setIsPublic(project.isPublic);
      setDisplayName(project.displayName || '');
      setDescription(project.description || '');
      setUnauthorizedBehavior(project.unauthorizedBehavior || 'not_found');
      setRequiredRole(project.requiredRole || 'authenticated');
    }
  }, [project]);

  // Check if form has changes
  useEffect(() => {
    if (project) {
      const changed =
        isPublic !== project.isPublic ||
        displayName !== (project.displayName || '') ||
        description !== (project.description || '') ||
        unauthorizedBehavior !== (project.unauthorizedBehavior || 'not_found') ||
        requiredRole !== (project.requiredRole || 'authenticated');
      setHasChanges(changed);
    }
  }, [project, isPublic, displayName, description, unauthorizedBehavior, requiredRole]);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isLoadingSession && !isAuthenticated) {
      toast({
        title: 'Authentication required',
        description: 'You must be logged in to access project settings.',
        variant: 'destructive',
      });
      navigate(`/login?redirect=${encodeURIComponent(window.location.pathname)}`);
    }
  }, [isLoadingSession, isAuthenticated, navigate, toast]);

  // Handle save
  const handleSave = async () => {
    if (!project || !hasChanges) return;

    try {
      await updateProject({
        id: project.id,
        updates: {
          isPublic,
          displayName: displayName || undefined,
          description: description || undefined,
          unauthorizedBehavior,
          requiredRole,
        },
      }).unwrap();

      toast({
        title: 'Settings saved',
        description: 'Project settings have been updated successfully.',
      });
      setHasChanges(false);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error?.data?.message || 'Failed to update project settings',
        variant: 'destructive',
      });
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="bg-background">
        <div className="border-b">
          <div className="px-4 py-3">
            <Skeleton className="h-6 w-64" />
          </div>
        </div>
        <div className="p-8 max-w-6xl mx-auto space-y-6">
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    const errorStatus = (error as any)?.status;
    const errorMessage = (error as any)?.data?.message || 'Unknown error';
    const isForbidden = errorStatus === 403;

    return (
      <div className="min-h-screen bg-background">
        <div className="p-8 max-w-2xl mx-auto">
          <Alert variant="destructive">
            {isForbidden ? <Lock className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
            <AlertDescription>
              {isForbidden
                ? 'You do not have permission to access this project settings. Admin or owner role required.'
                : `Failed to load project settings. ${errorMessage}`}
            </AlertDescription>
          </Alert>
          <div className="mt-4">
            <Button variant="outline" onClick={() => navigate(`/repo/${owner}/${repo}`)}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Repository
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Permission check - show error if user doesn't have admin access
  if (!isLoading && isAuthenticated && project && permissions && !hasAdminAccess) {
    return (
      <div className="min-h-screen bg-background">
        <div className="p-8 max-w-2xl mx-auto">
          <Alert variant="destructive">
            <Lock className="h-4 w-4" />
            <AlertDescription>
              You do not have permission to access project settings. Admin or owner role required.
            </AlertDescription>
          </Alert>
          <div className="mt-4">
            <Button variant="outline" onClick={() => navigate(`/repo/${owner}/${repo}`)}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Repository
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!project) {
    return null;
  }

  return (
    <div className="bg-background">
      {/* Breadcrumb Header */}
      <div className="border-b">
        <div className="px-4 py-3">
          <RepoBreadcrumb owner={owner!} repo={repo!} suffixLabel="Settings" />
        </div>
      </div>

      {/* Content */}
      <div className="p-8 max-w-6xl mx-auto">
        <Tabs value={currentTab} onValueChange={handleTabChange}>
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="members">Members</TabsTrigger>
            <TabsTrigger value="groups">Groups</TabsTrigger>
            <TabsTrigger value="api-keys">API Keys</TabsTrigger>
            <TabsTrigger value="proxy-rules">Proxy Rules</TabsTrigger>
            <TabsTrigger value="storage">Storage</TabsTrigger>
            <TabsTrigger value="cache-rules">Cache Rules</TabsTrigger>
            <TabsTrigger value="share-links">Share Links</TabsTrigger>
          </TabsList>

          {/* General Tab */}
          <TabsContent value="general" className="space-y-6 mt-6">
            {/* Project Info */}
            <Card>
              <CardHeader>
                <CardTitle>Project Information</CardTitle>
                <CardDescription>
                  Basic information about your project
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="owner">Owner</Label>
                  <Input id="owner" value={project.owner} disabled />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" value={project.name} disabled />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="displayName">Display Name</Label>
                  <Input
                    id="displayName"
                    placeholder="Optional friendly name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Input
                    id="description"
                    placeholder="Optional description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
                <div className="text-sm text-muted-foreground">
                  Created: {new Date(project.createdAt).toLocaleDateString()}
                </div>
              </CardContent>
            </Card>

            {/* Visibility Settings */}
            <Card>
              <CardHeader>
                <CardTitle>Visibility</CardTitle>
                <CardDescription>
                  Control who can access your project and deployments
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="visibility">Project Visibility</Label>
                    <p className="text-sm text-muted-foreground">
                      {isPublic
                        ? 'Anyone can view this project and its deployments'
                        : 'Only users with permissions can access this project'}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground">
                      {isPublic ? 'Public' : 'Private'}
                    </span>
                    <Switch
                      id="visibility"
                      checked={isPublic}
                      onCheckedChange={setIsPublic}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Access Control Settings - Only shown when project is private */}
            {!isPublic && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="h-5 w-5" />
                    Access Control
                  </CardTitle>
                  <CardDescription>
                    Configure how unauthorized access is handled for private content
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <Label htmlFor="unauthorizedBehavior">Unauthorized Behavior</Label>
                    <Select
                      value={unauthorizedBehavior}
                      onValueChange={(value: 'not_found' | 'redirect_login') => setUnauthorizedBehavior(value)}
                    >
                      <SelectTrigger id="unauthorizedBehavior">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="not_found">Show 404 (Not Found)</SelectItem>
                        <SelectItem value="redirect_login">Redirect to Login</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-sm text-muted-foreground">
                      {unauthorizedBehavior === 'not_found'
                        ? 'Unauthenticated users will see a 404 page (hides existence of content)'
                        : 'Unauthenticated users will be redirected to login, then back to the content'}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="requiredRole">Required Role</Label>
                    <Select
                      value={requiredRole}
                      onValueChange={(value: 'authenticated' | 'viewer' | 'contributor' | 'admin' | 'owner') => setRequiredRole(value)}
                    >
                      <SelectTrigger id="requiredRole">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="authenticated">Any authenticated user</SelectItem>
                        <SelectItem value="viewer">Viewer or higher</SelectItem>
                        <SelectItem value="contributor">Contributor or higher</SelectItem>
                        <SelectItem value="admin">Admin or higher</SelectItem>
                        <SelectItem value="owner">Owner only</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-sm text-muted-foreground">
                      Minimum role required to access this project's deployments. Users without this role will see a 403 error.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Save Button */}
            {hasChanges && (
              <div className="flex justify-end">
                <Button onClick={handleSave} disabled={isUpdating}>
                  <Save className="h-4 w-4 mr-2" />
                  {isUpdating ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            )}

            {/* Danger Zone - Only visible to owners */}
            {hasOwnerAccess && (
              <Card className="border-destructive">
                <CardHeader>
                  <CardTitle className="text-destructive">Danger Zone</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <p className="font-medium">Delete this repository</p>
                      <p className="text-sm text-muted-foreground">
                        Permanently delete this repository and all of its data, including deployments, aliases, and uploaded files.
                      </p>
                    </div>
                    <Button
                      variant="destructive"
                      onClick={() => setDeleteDialogOpen(true)}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete Repository
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Delete Project Dialog */}
            {project && (
              <DeleteProjectDialog
                projectId={project.id}
                owner={owner!}
                repo={repo!}
                open={deleteDialogOpen}
                onOpenChange={setDeleteDialogOpen}
              />
            )}
          </TabsContent>

          {/* Members Tab */}
          <TabsContent value="members" className="mt-6">
            {project && <ProjectMembersTab owner={owner!} repo={repo!} />}
          </TabsContent>

          {/* Groups Tab */}
          <TabsContent value="groups" className="mt-6">
            {project && <ProjectGroupsTab owner={owner!} repo={repo!} />}
          </TabsContent>

          {/* API Keys Tab */}
          <TabsContent value="api-keys" className="mt-6">
            {project && <ProjectApiKeysTab project={project} />}
          </TabsContent>

          {/* Proxy Rules Tab */}
          <TabsContent value="proxy-rules" className="mt-6">
            {project && <ProjectProxyRulesTab project={project} />}
          </TabsContent>

          {/* Storage & Retention Tab */}
          <TabsContent value="storage" className="mt-6">
            {project && <ProjectStorageRetentionTab project={project} />}
          </TabsContent>

          {/* Cache Rules Tab */}
          <TabsContent value="cache-rules" className="mt-6">
            {project && <ProjectCacheRulesTab project={project} />}
          </TabsContent>

          {/* Share Links Tab */}
          <TabsContent value="share-links" className="mt-6">
            {project && <ProjectShareLinksTab project={project} />}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
