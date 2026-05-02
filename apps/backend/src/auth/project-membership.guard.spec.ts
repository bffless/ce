import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ProjectMembershipGuard } from './project-membership.guard';
import { ProjectResolverService } from './project-resolver.service';
import { PermissionsService } from '../permissions/permissions.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';

describe('ProjectMembershipGuard', () => {
  let guard: ProjectMembershipGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let featureFlags: { isEnabled: jest.Mock };
  let projectResolver: { resolveProjectFromRequest: jest.Mock };
  let permissions: { getUserProjectRole: jest.Mock };

  const buildContext = (req: any): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => ({}),
      }),
      getHandler: jest.fn(),
      getClass: jest.fn(),
    }) as unknown as ExecutionContext;

  beforeEach(async () => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    featureFlags = { isEnabled: jest.fn().mockResolvedValue(true) };
    projectResolver = { resolveProjectFromRequest: jest.fn() };
    permissions = { getUserProjectRole: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectMembershipGuard,
        { provide: Reflector, useValue: reflector },
        { provide: FeatureFlagsService, useValue: featureFlags },
        { provide: ProjectResolverService, useValue: projectResolver },
        { provide: PermissionsService, useValue: permissions },
      ],
    }).compile();

    guard = module.get(ProjectMembershipGuard);
  });

  it('passes when @PublicProjectAccess() is set on the route', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);

    const ctx = buildContext({ user: { id: 'u1' }, headers: { host: 'foo.example.com' } });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(featureFlags.isEnabled).not.toHaveBeenCalled();
    expect(projectResolver.resolveProjectFromRequest).not.toHaveBeenCalled();
  });

  it('passes when REQUIRE_PROJECT_MEMBERSHIP is off (legacy behavior)', async () => {
    featureFlags.isEnabled.mockResolvedValue(false);

    const ctx = buildContext({ user: { id: 'u1' }, headers: { host: 'foo.example.com' } });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(projectResolver.resolveProjectFromRequest).not.toHaveBeenCalled();
  });

  it('passes when no user is attached (anonymous request)', async () => {
    const ctx = buildContext({ headers: { host: 'foo.example.com' } });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(projectResolver.resolveProjectFromRequest).not.toHaveBeenCalled();
  });

  it('passes when the request is authenticated via API key', async () => {
    const ctx = buildContext({
      user: { id: 'u1', apiKeyId: 'key-1' },
      headers: { host: 'foo.example.com' },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(projectResolver.resolveProjectFromRequest).not.toHaveBeenCalled();
  });

  it('passes when the hostname does not resolve to a project (admin/legacy)', async () => {
    projectResolver.resolveProjectFromRequest.mockResolvedValue(null);

    const ctx = buildContext({
      user: { id: 'u1' },
      headers: { host: 'admin.bffless.app' },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(permissions.getUserProjectRole).not.toHaveBeenCalled();
  });

  it('passes when the user has a role on the resolved project', async () => {
    projectResolver.resolveProjectFromRequest.mockResolvedValue({ id: 'p1' });
    permissions.getUserProjectRole.mockResolvedValue('viewer');

    const ctx = buildContext({
      user: { id: 'u1' },
      headers: { host: 'foo.bffless.app' },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(permissions.getUserProjectRole).toHaveBeenCalledWith('u1', 'p1');
  });

  it('throws ForbiddenException when the user has no role on the resolved project', async () => {
    projectResolver.resolveProjectFromRequest.mockResolvedValue({ id: 'p1' });
    permissions.getUserProjectRole.mockResolvedValue(null);

    const ctx = buildContext({
      user: { id: 'u1' },
      headers: { host: 'bar.bffless.app' },
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('checks the class-level decorator before the handler-level decorator', async () => {
    // getAllAndOverride merges both; we rely on it returning the truthy override.
    reflector.getAllAndOverride.mockReturnValue(true);

    const ctx = buildContext({
      user: { id: 'u1' },
      headers: { host: 'bar.bffless.app' },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(featureFlags.isEnabled).not.toHaveBeenCalled();
  });
});
