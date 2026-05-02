import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { MeController } from './me.controller';
import {
  MyProjectMembership,
  PermissionsService,
} from '../permissions/permissions.service';
import { CurrentUserData } from '../auth';

const makeUser = (id = 'user-1'): CurrentUserData => ({
  id,
  email: 'u@example.com',
  role: 'member',
  sessionHandle: 'sh-1',
});

describe('MeController', () => {
  let controller: MeController;
  let permissions: jest.Mocked<PermissionsService>;

  beforeEach(() => {
    permissions = {
      listUserProjectMemberships: jest.fn(),
      revokeSystemPermission: jest.fn(),
    } as unknown as jest.Mocked<PermissionsService>;

    controller = new MeController(permissions);
  });

  describe('GET /api/me/projects', () => {
    it('returns memberships for the signed-in user', async () => {
      const memberships: MyProjectMembership[] = [
        {
          projectId: 'p-1',
          projectName: 'Bella Charlesworth Real Estate',
          projectSlug: 'bffless/realestate-modern',
          primaryUrl: 'https://www.bellacharlesworth.com',
          role: 'guest',
          joinedAt: '2026-04-30T00:00:00.000Z',
          ownerEmail: 'james@example.com',
        },
      ];
      permissions.listUserProjectMemberships.mockResolvedValue(memberships);

      const result = await controller.listMyProjects(makeUser());

      expect(permissions.listUserProjectMemberships).toHaveBeenCalledWith('user-1');
      expect(result).toEqual(memberships);
    });

    it('returns empty array when user has no memberships', async () => {
      permissions.listUserProjectMemberships.mockResolvedValue([]);
      const result = await controller.listMyProjects(makeUser());
      expect(result).toEqual([]);
    });
  });

  describe('DELETE /api/me/projects/:projectId', () => {
    it('revokes the caller’s membership when they are a non-owner member', async () => {
      permissions.revokeSystemPermission.mockResolvedValue(undefined);

      await expect(
        controller.leaveProject(makeUser('user-1'), 'project-1'),
      ).resolves.toBeUndefined();

      expect(permissions.revokeSystemPermission).toHaveBeenCalledWith('project-1', 'user-1');
    });

    it('rewrites a ForbiddenException (owner) into a 400 with transfer-ownership guidance', async () => {
      permissions.revokeSystemPermission.mockRejectedValue(
        new ForbiddenException('Cannot revoke owner permission. Use transfer ownership instead.'),
      );

      await expect(
        controller.leaveProject(makeUser('owner-1'), 'project-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns 404 when the user is not a member', async () => {
      permissions.revokeSystemPermission.mockRejectedValue(
        new NotFoundException('Permission not found'),
      );

      await expect(
        controller.leaveProject(makeUser('stranger-1'), 'project-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rethrows unexpected errors unchanged', async () => {
      const boom = new Error('db down');
      permissions.revokeSystemPermission.mockRejectedValue(boom);

      await expect(
        controller.leaveProject(makeUser(), 'project-1'),
      ).rejects.toBe(boom);
    });
  });
});
