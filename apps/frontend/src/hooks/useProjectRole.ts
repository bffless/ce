import { useGetSessionQuery } from '@/services/authApi';
import { useGetProjectPermissionsQuery, type ProjectRole } from '@/services/permissionsApi';

interface UseProjectRoleResult {
  role: ProjectRole | null;
  isLoading: boolean;
  canEdit: boolean; // contributor, admin, or owner
  canAdmin: boolean; // admin or owner
  isOwner: boolean;
}

/**
 * Hook to get the current user's role for a project
 * Returns the effective role based on direct user permissions
 */
export function useProjectRole(owner: string, repo: string): UseProjectRoleResult {
  const { data: sessionData, isLoading: isLoadingSession } = useGetSessionQuery();
  const currentUser = sessionData?.user;

  const { data: permissions, isLoading: isLoadingPermissions } = useGetProjectPermissionsQuery(
    { owner, repo },
    { skip: !owner || !repo || !currentUser }
  );

  const isLoading = isLoadingSession || isLoadingPermissions;

  // Find user's direct permission
  const userPermission = permissions?.userPermissions.find(
    (perm) => perm.userId === currentUser?.id
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
  };
}
