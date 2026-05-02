import { Request } from 'express';
import { buildLoginMethodsResponse } from './login-methods.helper';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { SetupService } from '../setup/setup.service';
import { ProjectResolverService } from './project-resolver.service';

const reqStub = {} as Request;

const makeFlags = (
  values: Partial<Record<'ENABLE_GOOGLE_OAUTH' | 'REQUIRE_PROJECT_MEMBERSHIP', boolean>>,
): FeatureFlagsService =>
  ({
    isEnabled: jest.fn(async (key: string) => values[key as keyof typeof values] ?? false),
  }) as unknown as FeatureFlagsService;

const makeSetup = (canPublicSignup: boolean): SetupService =>
  ({
    canPublicSignup: jest.fn(async () => canPublicSignup),
  }) as unknown as SetupService;

const makeResolver = (project: { id: string; allowPublicSignup: boolean } | null): ProjectResolverService =>
  ({
    resolveProjectFromRequest: jest.fn(async () => project),
  }) as unknown as ProjectResolverService;

describe('buildLoginMethodsResponse', () => {
  describe('top-level back-compat fields', () => {
    it('always returns hasPassword: true and hasGoogle from the workspace flag', async () => {
      const res = await buildLoginMethodsResponse({
        featureFlagsService: makeFlags({ ENABLE_GOOGLE_OAUTH: true }),
        setupService: makeSetup(true),
        projectResolver: makeResolver(null),
        req: reqStub,
      });

      expect(res.hasPassword).toBe(true);
      expect(res.hasGoogle).toBe(true);
      // Same values are mirrored under workspace.* — old + new fields agree.
      expect(res.workspace.hasPassword).toBe(true);
      expect(res.workspace.hasGoogle).toBe(true);
    });
  });

  describe('workspace namespace', () => {
    it('reports allowSignup from setupService.canPublicSignup()', async () => {
      const res = await buildLoginMethodsResponse({
        featureFlagsService: makeFlags({}),
        setupService: makeSetup(false),
        projectResolver: makeResolver(null),
        req: reqStub,
      });

      expect(res.workspace.allowSignup).toBe(false);
    });

    it('falls back to hasGoogle=false if the feature-flag lookup throws', async () => {
      const flags = {
        isEnabled: jest.fn(async () => {
          throw new Error('flag service down');
        }),
      } as unknown as FeatureFlagsService;

      const res = await buildLoginMethodsResponse({
        featureFlagsService: flags,
        setupService: makeSetup(true),
        projectResolver: makeResolver(null),
        req: reqStub,
      });

      expect(res.hasGoogle).toBe(false);
      expect(res.workspace.hasGoogle).toBe(false);
    });
  });

  describe('project namespace', () => {
    it('omits the project key when REQUIRE_PROJECT_MEMBERSHIP is off', async () => {
      const resolver = makeResolver({ id: 'p1', allowPublicSignup: false });

      const res = await buildLoginMethodsResponse({
        featureFlagsService: makeFlags({ REQUIRE_PROJECT_MEMBERSHIP: false }),
        setupService: makeSetup(true),
        projectResolver: resolver,
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
        req: reqStub,
      });

      expect(res.project).toBeUndefined();
    });

    it('includes project.allowSignup=true when project allows it and master switch is on', async () => {
      const res = await buildLoginMethodsResponse({
        featureFlagsService: makeFlags({ REQUIRE_PROJECT_MEMBERSHIP: true }),
        setupService: makeSetup(true),
        projectResolver: makeResolver({ id: 'p1', allowPublicSignup: true }),
        req: reqStub,
      });

      expect(res.project).toEqual({ allowSignup: true });
    });

    it('includes project.allowSignup=false when project forbids it and master switch is on', async () => {
      const res = await buildLoginMethodsResponse({
        featureFlagsService: makeFlags({ REQUIRE_PROJECT_MEMBERSHIP: true }),
        setupService: makeSetup(true),
        projectResolver: makeResolver({ id: 'p1', allowPublicSignup: false }),
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
        req: reqStub,
      });

      expect(res.workspace.allowSignup).toBe(true);
      expect(res.project?.allowSignup).toBe(false);
    });
  });
});
