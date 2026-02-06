import Multitenancy from 'supertokens-node/recipe/multitenancy';

/**
 * Tenant Registration Utilities
 *
 * These functions are used in multi-tenant mode to manage tenants
 * in the shared SuperTokens instance. They are called by the
 * control plane when provisioning or deprovisioning tenants.
 *
 * Note: These only work when SUPERTOKENS_MULTI_TENANT=true
 * In single-tenant mode (default), these functions are no-ops.
 */

/**
 * Check if multi-tenant mode is enabled
 */
function isMultiTenantMode(): boolean {
  return process.env.SUPERTOKENS_MULTI_TENANT === 'true';
}

/**
 * Register a new tenant with SuperTokens
 * This creates the tenant in the shared SuperTokens instance
 * and enables email/password authentication for it.
 *
 * In single-tenant mode (default), this is a no-op that returns success.
 *
 * @param tenantId - Unique identifier for the tenant (e.g., 'acme-corp')
 * @returns Object with tenantId and status
 */
export async function registerTenant(
  tenantId: string,
): Promise<{ tenantId: string; status: string }> {
  // In single-tenant mode (default), skip tenant registration
  // All users go into the 'public' tenant
  if (!isMultiTenantMode()) {
    console.log(
      `[SingleTenant] Skipping tenant registration for '${tenantId}' - using 'public' tenant`,
    );
    return { tenantId: 'public', status: 'single_tenant_mode' };
  }

  if (!tenantId || tenantId.trim() === '') {
    throw new Error('Tenant ID is required');
  }

  // Validate tenant ID format (alphanumeric with hyphens, no special chars)
  const tenantIdRegex = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
  if (!tenantIdRegex.test(tenantId) && tenantId !== 'public') {
    throw new Error('Tenant ID must be lowercase alphanumeric with hyphens (e.g., acme-corp)');
  }

  await Multitenancy.createOrUpdateTenant(tenantId, {
    emailPasswordEnabled: true,
  });

  return { tenantId, status: 'created' };
}

/**
 * Delete a tenant from SuperTokens
 * This removes the tenant and all associated users from
 * the shared SuperTokens instance.
 *
 * WARNING: This is destructive and cannot be undone!
 *
 * In single-tenant mode (default), this is a no-op that returns success.
 *
 * @param tenantId - Unique identifier for the tenant to delete
 * @returns Object with tenantId and status
 */
export async function deleteTenant(
  tenantId: string,
): Promise<{ tenantId: string; status: string }> {
  // In single-tenant mode (default), skip tenant deletion
  if (!isMultiTenantMode()) {
    console.log(
      `[SingleTenant] Skipping tenant deletion for '${tenantId}' - single-tenant mode`,
    );
    return { tenantId, status: 'single_tenant_mode' };
  }

  if (!tenantId || tenantId.trim() === '') {
    throw new Error('Tenant ID is required');
  }

  // Prevent deletion of the default 'public' tenant
  if (tenantId === 'public') {
    throw new Error('Cannot delete the default public tenant');
  }

  await Multitenancy.deleteTenant(tenantId);

  return { tenantId, status: 'deleted' };
}

/**
 * Get tenant information from SuperTokens
 *
 * In single-tenant mode (default), returns info for 'public' tenant.
 *
 * @param tenantId - Unique identifier for the tenant
 * @returns Tenant configuration or null if not found
 */
export async function getTenant(tenantId: string): Promise<{
  tenantId: string;
  emailPasswordEnabled: boolean;
} | null> {
  // In single-tenant mode, always return public tenant info
  if (!isMultiTenantMode()) {
    return {
      tenantId: 'public',
      emailPasswordEnabled: true,
    };
  }

  try {
    const tenant = await Multitenancy.getTenant(tenantId);
    if (!tenant || tenant.status !== 'OK') {
      return null;
    }

    return {
      tenantId: tenantId,
      emailPasswordEnabled: tenant.emailPassword?.enabled ?? false,
    };
  } catch {
    return null;
  }
}
