import { Request } from 'express';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { SetupService } from '../setup/setup.service';
import { ProjectResolverService } from './project-resolver.service';
import { OidcProvidersService } from '../settings/oidc-providers.service';

/**
 * Public site-capability response shared by the workspace-subdomain
 * (`/api/auth/login-methods`) and custom-domain (`/_bffless/auth/login-methods`)
 * endpoints. Consumed by AuthDialog (in @bffless/components) and the CE
 * Login/Signup pages to decide which auth UI to render.
 *
 * The `providers` array is the authoritative shape after story 0047.
 * `hasGoogle` (top-level and on workspace) is preserved purely so older
 * AuthDialog bundles (≤0.17.x) shipped with already-deployed customer sites
 * keep rendering the Google button when a Google provider is enabled — those
 * old bundles don't know about `providers`. Once @bffless/components 1.0
 * lands, `hasGoogle` becomes removable.
 */
export interface LoginMethodsResponse {
  /** @deprecated Use `workspace.hasPassword`. Kept for older AuthDialog versions. */
  hasPassword: boolean;
  /** @deprecated Use `providers`. Kept for older AuthDialog versions (<=0.17.x). */
  hasGoogle: boolean;
  workspace: {
    hasPassword: boolean;
    /** @deprecated Use top-level `providers`. */
    hasGoogle: boolean;
    /**
     * Whether this workspace accepts new public signups at all (admin kill
     * switch + the `canPublicSignup` toggle). When false, no project can
     * accept signups regardless of its own setting.
     */
    allowSignup: boolean;
  };
  /**
   * Enabled OIDC sign-in providers, in display order. Empty when the master
   * `ENABLE_OIDC_PROVIDERS` switch is off or no providers are configured.
   * AuthDialog (≥0.18.0) renders one button per entry.
   */
  providers: Array<{
    id: string;
    kind: 'google' | 'okta' | 'azure-ad' | 'oidc';
    displayName: string;
  }>;
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
  oidcProvidersService: OidcProvidersService;
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
  oidcProvidersService,
  req,
}: BuildOpts): Promise<LoginMethodsResponse> {
  // Email/password is available unless the operator forces OIDC-only via the
  // ENABLE_EMAIL_PASSWORD master switch. Default to true if the lookup fails so
  // a transient flag-store error never hides the only built-in login method.
  const hasPassword = await featureFlagsService
    .isEnabled('ENABLE_EMAIL_PASSWORD')
    .catch(() => true);

  // Master switch for OIDC sign-in. When off, no buttons regardless of rows.
  const oidcEnabled = await featureFlagsService
    .isEnabled('ENABLE_OIDC_PROVIDERS')
    .catch(() => false);

  const providers = oidcEnabled ? await oidcProvidersService.listEnabled().catch(() => []) : [];

  // hasGoogle stays true whenever any kind=google provider is enabled, so
  // AuthDialog ≤0.17.x bundles deployed on customer sites keep rendering the
  // Google button. New bundles read `providers` directly and ignore this.
  const hasGoogle = providers.some((p) => p.kind === 'google');

  // canPublicSignup() already AND's isRegistrationFeatureEnabled internally
  // (see setup.service.ts), so a single call captures the workspace gate.
  const workspaceAllowSignup = await setupService.canPublicSignup().catch(() => false);

  const membershipGateOn = await featureFlagsService
    .isEnabled('REQUIRE_PROJECT_MEMBERSHIP')
    .catch(() => false);

  const project = membershipGateOn ? await projectResolver.resolveProjectFromRequest(req) : null;

  return {
    hasPassword,
    hasGoogle,
    providers,
    workspace: {
      hasPassword,
      hasGoogle,
      allowSignup: workspaceAllowSignup,
    },
    ...(project ? { project: { allowSignup: project.allowPublicSignup } } : {}),
  };
}
