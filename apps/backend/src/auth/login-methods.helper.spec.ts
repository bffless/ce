import { Request } from 'express';
import { buildLoginMethodsResponse } from './login-methods.helper';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { SetupService } from '../setup/setup.service';
import { ProjectResolverService } from './project-resolver.service';
import { OidcProvidersService } from '../settings/oidc-providers.service';

const reqStub = {} as Request;

const makeFlags = (
  values: Partial<
    Record<
      'ENABLE_OIDC_PROVIDERS' | 'REQUIRE_PROJECT_MEMBERSHIP' | 'ENABLE_EMAIL_PASSWORD',
      boolean
    >
  >,
): FeatureFlagsService =>
  ({
    // ENABLE_EMAIL_PASSWORD defaults to true (matching the production flag
    // default) unless a test overrides it; every other flag defaults to false.
    isEnabled: jest.fn(async (key: string) =>
      key === 'ENABLE_EMAIL_PASSWORD'
        ? (values.ENABLE_EMAIL_PASSWORD ?? true)
        : (values[key as keyof typeof values] ?? false),
    ),
  }) as unknown as FeatureFlagsService;

const makeSetup = (canPublicSignup: boolean): SetupService =>
  ({
    canPublicSignup: jest.fn(async () => canPublicSignup),
  }) as unknown as SetupService;

const makeResolver = (
  project: { id: string; allowPublicSignup: boolean } | null,
): ProjectResolverService =>
  ({
    resolveProjectFromRequest: jest.fn(async () => project),
  }) as unknown as ProjectResolverService;

const makeOidc = (
  providers: Array<{
    id: string;
    kind: 'google' | 'okta' | 'azure-ad' | 'oidc';
    displayName: string;
  }>,
): OidcProvidersService =>
  ({
    listEnabled: jest.fn(async () => providers),
  }) as unknown as OidcProvidersService;

describe('buildLoginMethodsResponse', () => {
  describe('top-level back-compat fields', () => {
    it('returns hasGoogle=true when the master OIDC switch is on AND a kind=google provider is enabled', async () => {
      const res = await buildLoginMethodsResponse({
        featureFlagsService: makeFlags({ ENABLE_OIDC_PROVIDERS: true }),
        setupService: makeSetup(true),
        projectResolver: makeResolver(null),
        oidcProvidersService: makeOidc([{ id: 'google', kind: 'google', displayName: 'Google' }]),
        req: reqStub,
      });

      expect(res.hasPassword).toBe(true);
      expect(res.hasGoogle).toBe(true);
      // Same values are mirrored under workspace.* — old + new fields agree.
      expect(res.workspace.hasPassword).toBe(true);
      expect(res.workspace.hasGoogle).toBe(true);
      // New `providers` array is the authoritative shape.
      expect(res.providers).toEqual([{ id: 'google', kind: 'google', displayName: 'Google' }]);
    });

    it('returns hasGoogle=false when only non-Google providers are enabled', async () => {
      const res = await buildLoginMethodsResponse({
        featureFlagsService: makeFlags({ ENABLE_OIDC_PROVIDERS: true }),
        setupService: makeSetup(true),
        projectResolver: makeResolver(null),
        oidcProvidersService: makeOidc([
          { id: 'okta-acme', kind: 'okta', displayName: 'Acme SSO' },
        ]),
        req: reqStub,
      });

      expect(res.hasGoogle).toBe(false);
      expect(res.workspace.hasGoogle).toBe(false);
      expect(res.providers).toHaveLength(1);
    });

    it('reports hasPassword=false when ENABLE_EMAIL_PASSWORD is off (OIDC-only workspace)', async () => {
      const res = await buildLoginMethodsResponse({
        featureFlagsService: makeFlags({
          ENABLE_OIDC_PROVIDERS: true,
          ENABLE_EMAIL_PASSWORD: false,
        }),
        setupService: makeSetup(true),
        projectResolver: makeResolver(null),
        oidcProvidersService: makeOidc([
          { id: 'okta-acme', kind: 'okta', displayName: 'Acme SSO' },
        ]),
        req: reqStub,
      });

      expect(res.hasPassword).toBe(false);
      expect(res.workspace.hasPassword).toBe(false);
      // OIDC stays available — only the password method is gated.
      expect(res.providers).toHaveLength(1);
    });

    it('returns empty providers and hasGoogle=false when ENABLE_OIDC_PROVIDERS is off, even if rows exist', async () => {
      // Master switch off — no buttons regardless of what's in the table.
      const oidc = makeOidc([{ id: 'google', kind: 'google', displayName: 'Google' }]);
      const res = await buildLoginMethodsResponse({
        featureFlagsService: makeFlags({ ENABLE_OIDC_PROVIDERS: false }),
        setupService: makeSetup(true),
        projectResolver: makeResolver(null),
        oidcProvidersService: oidc,
        req: reqStub,
      });

      expect(res.providers).toEqual([]);
      expect(res.hasGoogle).toBe(false);
      // Service should not even be consulted when the switch is off.
      expect(oidc.listEnabled).not.toHaveBeenCalled();
    });
  });

  describe('workspace namespace', () => {
    it('reports allowSignup from setupService.canPublicSignup()', async () => {
      const res = await buildLoginMethodsResponse({
        featureFlagsService: makeFlags({}),
        setupService: makeSetup(false),
        projectResolver: makeResolver(null),
        oidcProvidersService: makeOidc([]),
        req: reqStub,
      });

      expect(res.workspace.allowSignup).toBe(false);
    });

    it('falls back to empty providers if listEnabled throws', async () => {
      const oidc = {
        listEnabled: jest.fn(async () => {
          throw new Error('db down');
        }),
      } as unknown as OidcProvidersService;

      const res = await buildLoginMethodsResponse({
        featureFlagsService: makeFlags({ ENABLE_OIDC_PROVIDERS: true }),
        setupService: makeSetup(true),
        projectResolver: makeResolver(null),
        oidcProvidersService: oidc,
        req: reqStub,
      });

      expect(res.hasGoogle).toBe(false);
      expect(res.providers).toEqual([]);
    });
  });

  describe('project namespace', () => {
    it('omits the project key when REQUIRE_PROJECT_MEMBERSHIP is off', async () => {
      const resolver = makeResolver({ id: 'p1', allowPublicSignup: false });

      const res = await buildLoginMethodsResponse({
        featureFlagsService: makeFlags({ REQUIRE_PROJECT_MEMBERSHIP: false }),
        setupService: makeSetup(true),
        projectResolver: resolver,
        oidcProvidersService: makeOidc([]),
        req: reqStub,
      });

      expect(res.project).toBeUndefined();
      // Resolver should not even be consulted when the master switch is off.
      expect(resolver.resolveProjectFromRequest).not.toHaveBeenCalled();
    });

    it('omits the project key when the resolver returns null (admin domain or unknown host)', async () => {
      const res = await buildLoginMethodsResponse({
        featureFlagsService: makeFlags({ REQUIRE_PROJECT_MEMBERSHIP: true }),
        setupService: makeSetup(true),
        projectResolver: makeResolver(null),
        oidcProvidersService: makeOidc([]),
        req: reqStub,
      });

      expect(res.project).toBeUndefined();
    });

    it('includes project.allowSignup=true when project allows it and master switch is on', async () => {
      const res = await buildLoginMethodsResponse({
        featureFlagsService: makeFlags({ REQUIRE_PROJECT_MEMBERSHIP: true }),
        setupService: makeSetup(true),
        projectResolver: makeResolver({ id: 'p1', allowPublicSignup: true }),
        oidcProvidersService: makeOidc([]),
        req: reqStub,
      });

      expect(res.project).toEqual({ allowSignup: true });
    });

    it('includes project.allowSignup=false when project forbids it and master switch is on', async () => {
      const res = await buildLoginMethodsResponse({
        featureFlagsService: makeFlags({ REQUIRE_PROJECT_MEMBERSHIP: true }),
        setupService: makeSetup(true),
        projectResolver: makeResolver({ id: 'p1', allowPublicSignup: false }),
        oidcProvidersService: makeOidc([]),
        req: reqStub,
      });

      expect(res.project).toEqual({ allowSignup: false });
    });

    it('reports project.allowSignup independently from workspace.allowSignup', async () => {
      // Workspace allows signup but the specific project does not — AuthDialog
      // must hide the Sign up tab on this project's site.
      const res = await buildLoginMethodsResponse({
        featureFlagsService: makeFlags({ REQUIRE_PROJECT_MEMBERSHIP: true }),
        setupService: makeSetup(true),
        projectResolver: makeResolver({ id: 'p1', allowPublicSignup: false }),
        oidcProvidersService: makeOidc([]),
        req: reqStub,
      });

      expect(res.workspace.allowSignup).toBe(true);
      expect(res.project?.allowSignup).toBe(false);
    });
  });
});
