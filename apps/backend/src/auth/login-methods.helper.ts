import { Request } from 'express';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { SetupService } from '../setup/setup.service';
import { ProjectResolverService } from './project-resolver.service';

/**
 * Public site-capability response shared by the workspace-subdomain
 * (`/api/auth/login-methods`) and custom-domain (`/_bffless/auth/login-methods`)
 * endpoints. Consumed by AuthDialog to decide which auth UI to render.
 *
 * Top-level `hasPassword`/`hasGoogle` are kept for backwards compatibility
 * with older AuthDialog bundles. New code should read from `workspace.*` and
 * the optional `project.*`.
 */
export interface LoginMethodsResponse {
  /** @deprecated Use `workspace.hasPassword`. Kept for older AuthDialog versions. */
  hasPassword: boolean;
  /** @deprecated Use `workspace.hasGoogle`. Kept for older AuthDialog versions. */
  hasGoogle: boolean;
  workspace: {
    hasPassword: boolean;
    hasGoogle: boolean;
    /**
     * Whether this workspace accepts new public signups at all (admin kill
     * switch + the `canPublicSignup` toggle). When false, no project can
     * accept signups regardless of its own setting.
     */
    allowSignup: boolean;
  };
  /**
   * Per-project signup gate. Present only when REQUIRE_PROJECT_MEMBERSHIP is
   * on AND the request hostname resolves to a project. Absent on the admin
   * domain or when the master switch is off.
   */
  project?: {
    allowSignup: boolean;
  };
}

interface BuildOpts {
  featureFlagsService: FeatureFlagsService;
  setupService: SetupService;
  projectResolver: ProjectResolverService;
  req: Request;
}

/**
 * Build the public site-capability response. Pulls workspace-level
 * provider/signup info from the existing services and consults the Phase A
 * project resolver only when `REQUIRE_PROJECT_MEMBERSHIP` is enabled.
 */
export async function buildLoginMethodsResponse({
  featureFlagsService,
  setupService,
  projectResolver,
  req,
}: BuildOpts): Promise<LoginMethodsResponse> {
  const hasPassword = true; // Email/password is always available in CE.

  const hasGoogle = await featureFlagsService
    .isEnabled('ENABLE_GOOGLE_OAUTH')
    .catch(() => false);

  // canPublicSignup() already AND's isRegistrationFeatureEnabled internally
  // (see setup.service.ts), so a single call captures the workspace gate.
  const workspaceAllowSignup = await setupService.canPublicSignup().catch(() => false);

  const membershipGateOn = await featureFlagsService
    .isEnabled('REQUIRE_PROJECT_MEMBERSHIP')
    .catch(() => false);

  const project = membershipGateOn
    ? await projectResolver.resolveProjectFromRequest(req)
    : null;

  return {
    hasPassword,
    hasGoogle,
    workspace: {
      hasPassword,
      hasGoogle,
      allowSignup: workspaceAllowSignup,
    },
    ...(project ? { project: { allowSignup: project.allowPublicSignup } } : {}),
  };
}
