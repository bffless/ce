import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * Tenant Middleware
 *
 * Sets the tenant ID on the request based on SUPERTOKENS_MULTI_TENANT:
 * - Single-tenant mode (default): Always uses 'public' tenant
 * - Multi-tenant mode: Uses ORGANIZATION_ID (or TENANT_ID for backward compatibility) from environment
 *
 * The organization ID maps to a SuperTokens tenant (auth boundary).
 * Multiple workspaces can share the same organization, enabling single sign-on.
 *
 * Also validates X-Organization-Id header in multi-tenant mode for defense in depth.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // Multi-tenant mode is opt-in - requires SUPERTOKENS_MULTI_TENANT=true
    const isMultiTenant = process.env.SUPERTOKENS_MULTI_TENANT === 'true';

    if (isMultiTenant) {
      // ORGANIZATION_ID is preferred, TENANT_ID for backward compatibility
      const organizationId = process.env.ORGANIZATION_ID || process.env.TENANT_ID;

      if (!organizationId) {
        return res
          .status(500)
          .json({ error: 'ORGANIZATION_ID not configured for multi-tenant mode' });
      }

      // Set tenantId on request for SuperTokens compatibility
      req.tenantId = organizationId;

      // Validate against header if present (defense in depth)
      // Accept both X-Organization-Id and legacy X-Tenant-Id headers
      const headerOrgId = req.headers['x-organization-id'] || req.headers['x-tenant-id'];
      if (headerOrgId && headerOrgId !== organizationId) {
        return res.status(403).json({ error: 'Organization mismatch' });
      }
    } else {
      // Single-tenant mode (default) - always use 'public' tenant
      req.tenantId = 'public';
    }

    next();
  }
}
