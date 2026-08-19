import { useGetSessionQuery } from '@/services/authApi';
import { useGetProjectPermissionsQuery, type ProjectRole } from '@/services/permissionsApi';

interface UseProjectRoleResult {
  role: ProjectRole | null;
  isLoading: boolean;
  canEdit: boolean; // contributor, admin, or owner
  canAdmin: boolean; // admin or owner
  isOwner: boolean;
  isGuest: boolean; // guest role (site access only, no admin backend)
}

/**
 * Hook to get the current user's role for a project
 * Returns the effective role based on direct user permissions
 */
export function useProjectRole(owner: string, repo: string): UseProjectRoleResult {
  const { data: sessionData, isLoading: isLoadingSession } = useGetSessionQuery();
  const currentUser = sessionData?.user;
  const isGlobalAdmin = currentUser?.role === 'admin';

  const { data: permissions, isLoading: isLoadingPermissions } = useGetProjectPermissionsQuery(
    { owner, repo },
    { skip: !owner || !repo || !currentUser || isGlobalAdmin },
  );

  // Global admins are project owners on every project in their workspace —
  // matches the backend ProjectPermissionGuard / PermissionsService bypass.
  if (isGlobalAdmin) {
    return {
      role: 'owner',
      isLoading: isLoadingSession,
      canEdit: true,
      canAdmin: true,
      isOwner: true,
      isGuest: false,
    };
  }

  const isLoading = isLoadingSession || isLoadingPermissions;

  // Find user's direct permission
  const userPermission = permissions?.userPermissions.find(
    (perm) => perm.userId === currentUser?.id,
  );

  // For now, we only check direct user permissions
  // TODO: Also check group memberships for inherited permissions
  const role = userPermission?.role ?? null;

  return {
    role,
    isLoading,
    canEdit: role ? ['owner', 'admin', 'contributor'].includes(role) : false,
    canAdmin: role ? ['owner', 'admin'].includes(role) : false,
    isOwner: role === 'owner',
    isGuest: role === 'guest',
  };
}
