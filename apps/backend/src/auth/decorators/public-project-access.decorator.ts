import { SetMetadata } from '@nestjs/common';

export const PUBLIC_PROJECT_ACCESS_KEY = 'publicProjectAccess';

/**
 * Mark a route (or controller) as bypassing the global ProjectMembershipGuard.
 *
 * Use for routes that legitimately serve any authenticated user regardless of
 * which project the inbound hostname resolves to. Examples:
 *
 *   - Admin/workspace-wide endpoints (user management, billing, project list).
 *   - Cross-project endpoints (e.g., a future `/api/me/projects` listing).
 *   - Public-content controllers that intentionally serve sister-site visitors.
 *   - Auth endpoints that already enforce membership inline (`AuthController`,
 *     `CustomDomainAuthController` — see Phase A and Phase B), so the guard
 *     would otherwise pre-empt their controlled response shapes.
 *
 * Greppable: `git grep '@PublicProjectAccess'` lists every cross-project
 * endpoint that bypasses the membership gate.
 */
export const PublicProjectAccess = () => SetMetadata(PUBLIC_PROJECT_ACCESS_KEY, true);
