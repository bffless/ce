import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PermissionsService } from './permissions.service';
import { db } from '../db/client';

// Mock db module
jest.mock('../db/client', () => ({
  db: {
    select: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
}));

describe('PermissionsService', () => {
  let service: PermissionsService;

  const mockUserId = 'user-123';
  const mockProjectId = 'project-456';
  const mockGroupId = 'group-789';
  const mockGrantedBy = 'admin-111';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PermissionsService],
    }).compile();

    service = module.get<PermissionsService>(PermissionsService);

    // Reset all mocks before each test
    jest.clearAllMocks();
  });

  describe('getUserProjectRole', () => {
    it('should return direct user permission role if exists', async () => {
      const mockDirectPermission = { role: 'admin', userId: mockUserId, projectId: mockProjectId };

      (db.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([mockDirectPermission]),
      });

      const result = await service.getUserProjectRole(mockUserId, mockProjectId);

      expect(result).toBe('admin');
    });

    it('should return highest group role if no direct permission', async () => {
      // No direct permission
      (db.select as jest.Mock).mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]),
      });

      // Group permissions
      (db.select as jest.Mock).mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([{ role: 'viewer' }, { role: 'contributor' }]),
      });

      const result = await service.getUserProjectRole(mockUserId, mockProjectId);

      expect(result).toBe('contributor'); // Highest role
    });

    it('should return admin as highest group role', async () => {
      (db.select as jest.Mock).mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]),
      });

      (db.select as jest.Mock).mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([{ role: 'admin' }, { role: 'contributor' }]),
      });

      const result = await service.getUserProjectRole(mockUserId, mockProjectId);

      expect(result).toBe('admin');
    });

    it('should return null if no permissions found', async () => {
      (db.select as jest.Mock).mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]),
      });

      (db.select as jest.Mock).mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([]),
      });

      const result = await service.getUserProjectRole(mockUserId, mockProjectId);

      expect(result).toBeNull();
    });
  });

  describe('hasProjectAccess', () => {
    it('should return true if user has required role', async () => {
      jest.spyOn(service, 'getUserProjectRole').mockResolvedValue('admin');

      const result = await service.hasProjectAccess(mockUserId, mockProjectId, 'contributor');

      expect(result).toBe(true);
    });

    it('should return true if user has higher role than required', async () => {
      jest.spyOn(service, 'getUserProjectRole').mockResolvedValue('owner');

      const result = await service.hasProjectAccess(mockUserId, mockProjectId, 'viewer');

      expect(result).toBe(true);
    });

    it('should return false if user has lower role than required', async () => {
      jest.spyOn(service, 'getUserProjectRole').mockResolvedValue('viewer');

      const result = await service.hasProjectAccess(mockUserId, mockProjectId, 'admin');

      expect(result).toBe(false);
    });

    it('should return false if user has no role', async () => {
      jest.spyOn(service, 'getUserProjectRole').mockResolvedValue(null);

      const result = await service.hasProjectAccess(mockUserId, mockProjectId, 'viewer');

      expect(result).toBe(false);
    });
  });

  describe('enforceApiKeyProjectScope', () => {
    const projectA = 'project-A';
    const projectB = 'project-B';

    it('is a no-op for session auth (apiKeyProjectId === undefined)', () => {
      expect(() => service.enforceApiKeyProjectScope(undefined, projectA)).not.toThrow();
    });

    it('is a no-op for global api-keys (apiKeyProjectId === null)', () => {
      expect(() => service.enforceApiKeyProjectScope(null, projectA)).not.toThrow();
    });

    it('allows when api-key scope matches the target project', () => {
      expect(() => service.enforceApiKeyProjectScope(projectA, projectA)).not.toThrow();
    });

    it('throws ForbiddenException when api-key scope does not match', () => {
      expect(() => service.enforceApiKeyProjectScope(projectA, projectB)).toThrow(
        ForbiddenException,
      );
    });
  });

  describe('requireProjectAccess', () => {
    const targetProject = mockProjectId;
    const otherProject = 'other-project-999';

    it('blocks an admin user when their api-key scope does not match (no admin shortcut on api-keys)', async () => {
      const spy = jest.spyOn(service, 'getUserProjectRole');

      await expect(
        service.requireProjectAccess(targetProject, mockUserId, 'admin', 'contributor', otherProject),
      ).rejects.toThrow(ForbiddenException);

      // Important: scope check must reject before consulting role hierarchy.
      expect(spy).not.toHaveBeenCalled();
    });

    it('allows when api-key scope matches the target project, regardless of role', async () => {
      const spy = jest.spyOn(service, 'getUserProjectRole');

      await expect(
        service.requireProjectAccess(targetProject, mockUserId, 'user', 'contributor', targetProject),
      ).resolves.toBeUndefined();

      // Scope match short-circuits — no need to look up the user role.
      expect(spy).not.toHaveBeenCalled();
    });

    it('falls through to role check for global api-keys (apiKeyProjectId === null)', async () => {
      jest.spyOn(service, 'getUserProjectRole').mockResolvedValue('contributor');

      await expect(
        service.requireProjectAccess(targetProject, mockUserId, 'user', 'contributor', null),
      ).resolves.toBeUndefined();
    });

    it('falls through to role check for session auth (apiKeyProjectId undefined)', async () => {
      jest.spyOn(service, 'getUserProjectRole').mockResolvedValue('contributor');

      await expect(
        service.requireProjectAccess(targetProject, mockUserId, 'user', 'contributor'),
      ).resolves.toBeUndefined();
    });

    it('grants system admins access without looking up project role (when no api-key context)', async () => {
      const spy = jest.spyOn(service, 'getUserProjectRole');

      await expect(
        service.requireProjectAccess(targetProject, mockUserId, 'admin', 'contributor'),
      ).resolves.toBeUndefined();

      expect(spy).not.toHaveBeenCalled();
    });

    it('rejects when user has no role on the project', async () => {
      jest.spyOn(service, 'getUserProjectRole').mockResolvedValue(null);

      await expect(
        service.requireProjectAccess(targetProject, mockUserId, 'user', 'viewer'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects when user role is below required role', async () => {
      jest.spyOn(service, 'getUserProjectRole').mockResolvedValue('viewer');

      await expect(
        service.requireProjectAccess(targetProject, mockUserId, 'user', 'admin'),
      ).rejects.toThrow(/admin role or higher/);
    });
  });

  describe('listUserProjects', () => {
    it('should return unique project IDs from direct and group permissions', async () => {
      const mockDirectPerms = [
        { projectId: 'proj-1', role: 'admin' },
        { projectId: 'proj-2', role: 'viewer' },
      ];

      const mockGroupPerms = [
        { projectId: 'proj-2', role: 'contributor' }, // Same project, higher role
        { projectId: 'proj-3', role: 'viewer' },
      ];

      (db.select as jest.Mock)
        .mockReturnValueOnce({
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockResolvedValue(mockDirectPerms),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnThis(),
          innerJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockResolvedValue(mockGroupPerms),
        });

      const result = await service.listUserProjects(mockUserId);

      expect(result).toHaveLength(3);
      expect(result).toContain('proj-1');
      expect(result).toContain('proj-2');
      expect(result).toContain('proj-3');
    });

    it('should filter by minimum role when specified', async () => {
      const mockDirectPerms = [
        { projectId: 'proj-1', role: 'admin' },
        { projectId: 'proj-2', role: 'viewer' },
      ];

      (db.select as jest.Mock)
        .mockReturnValueOnce({
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockResolvedValue(mockDirectPerms),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnThis(),
          innerJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockResolvedValue([]),
        });

      const result = await service.listUserProjects(mockUserId, 'contributor');

      expect(result).toHaveLength(1);
      expect(result).toContain('proj-1'); // Only admin role qualifies
    });
  });

  describe('grantPermission', () => {
    // Two-stage select mock: first call (target-user lookup) returns the supplied
    // user row, every subsequent call (existing-permission lookup, etc.) returns
    // the supplied existing row (or []). Implemented with mockImplementation so
    // state is contained to the current test — mockReturnValueOnce queues survive
    // jest.clearAllMocks() and would leak into neighbouring tests.
    const mockSelectChain = (
      targetUser: { role: string; email: string } | null,
      existing: { role: string }[] = [],
    ) => {
      let call = 0;
      (db.select as jest.Mock).mockImplementation(() => {
        call += 1;
        const result = call === 1 ? (targetUser ? [targetUser] : []) : existing;
        return {
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue(result),
        };
      });
    };

    it('should grant permission if granter is admin', async () => {
      jest.spyOn(service, 'getUserProjectRole').mockResolvedValue('admin');
      mockSelectChain({ role: 'user', email: 'target@example.com' });

      (db.insert as jest.Mock).mockReturnValue({
        values: jest.fn().mockResolvedValue(undefined),
      });

      await service.grantPermission(mockProjectId, mockUserId, 'contributor', mockGrantedBy);

      expect(db.insert).toHaveBeenCalled();
    });

    it('should throw if granter is not admin or owner', async () => {
      jest.spyOn(service, 'getUserProjectRole').mockResolvedValue('viewer');

      await expect(
        service.grantPermission(mockProjectId, mockUserId, 'contributor', mockGrantedBy),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw if trying to grant owner role', async () => {
      jest.spyOn(service, 'getUserProjectRole').mockResolvedValue('owner');

      await expect(
        service.grantPermission(mockProjectId, mockUserId, 'owner', mockGrantedBy),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should update existing permission if already exists', async () => {
      jest.spyOn(service, 'getUserProjectRole').mockResolvedValue('admin');
      mockSelectChain({ role: 'user', email: 'target@example.com' }, [{ role: 'viewer' }]);

      (db.update as jest.Mock).mockReturnValue({
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue(undefined),
      });

      await service.grantPermission(mockProjectId, mockUserId, 'admin', mockGrantedBy);

      expect(db.update).toHaveBeenCalled();
    });

    describe('role lanes', () => {
      it('rejects granting project admin to a global member', async () => {
        jest.spyOn(service, 'getUserProjectRole').mockResolvedValue('admin');
        mockSelectChain({ role: 'member', email: 'member@example.com' });

        await expect(
          service.grantPermission(mockProjectId, mockUserId, 'admin', mockGrantedBy),
        ).rejects.toThrow(
          /global 'member' role and cannot be granted the project 'admin' role/,
        );
      });

      it('rejects granting project contributor to a global member', async () => {
        jest.spyOn(service, 'getUserProjectRole').mockResolvedValue('admin');
        mockSelectChain({ role: 'member', email: 'member@example.com' });

        await expect(
          service.grantPermission(mockProjectId, mockUserId, 'contributor', mockGrantedBy),
        ).rejects.toThrow(ForbiddenException);
      });

      it('allows granting project viewer to a global member', async () => {
        jest.spyOn(service, 'getUserProjectRole').mockResolvedValue('admin');
        mockSelectChain({ role: 'member', email: 'member@example.com' });
        (db.insert as jest.Mock).mockReturnValue({
          values: jest.fn().mockResolvedValue(undefined),
        });

        await service.grantPermission(mockProjectId, mockUserId, 'viewer', mockGrantedBy);

        expect(db.insert).toHaveBeenCalled();
      });

      it('allows granting project guest to a global member', async () => {
        jest.spyOn(service, 'getUserProjectRole').mockResolvedValue('admin');
        mockSelectChain({ role: 'member', email: 'member@example.com' });
        (db.insert as jest.Mock).mockReturnValue({
          values: jest.fn().mockResolvedValue(undefined),
        });

        await service.grantPermission(mockProjectId, mockUserId, 'guest', mockGrantedBy);

        expect(db.insert).toHaveBeenCalled();
      });

      it('allows granting project admin to a global user', async () => {
        jest.spyOn(service, 'getUserProjectRole').mockResolvedValue('admin');
        mockSelectChain({ role: 'user', email: 'user@example.com' });
        (db.insert as jest.Mock).mockReturnValue({
          values: jest.fn().mockResolvedValue(undefined),
        });

        await service.grantPermission(mockProjectId, mockUserId, 'admin', mockGrantedBy);

        expect(db.insert).toHaveBeenCalled();
      });

      it('throws NotFoundException if the target user does not exist', async () => {
        jest.spyOn(service, 'getUserProjectRole').mockResolvedValue('admin');
        mockSelectChain(null);

        await expect(
          service.grantPermission(mockProjectId, mockUserId, 'viewer', mockGrantedBy),
        ).rejects.toThrow(/User not found/);
      });
    });
  });

  describe('grantSystemPermission', () => {
    it('inserts a new permission with grantedBy=null when none exists', async () => {
      (db.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]),
      });

      const valuesSpy = jest.fn().mockResolvedValue(undefined);
      (db.insert as jest.Mock).mockReturnValue({ values: valuesSpy });

      await service.grantSystemPermission(mockProjectId, mockUserId, 'guest');

      expect(db.insert).toHaveBeenCalled();
      expect(valuesSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: mockProjectId,
          userId: mockUserId,
          role: 'guest',
          grantedBy: null,
        }),
      );
    });

    it('updates an existing permission idempotently', async () => {
      (db.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([{ role: 'guest' }]),
      });

      const setSpy = jest.fn().mockReturnThis();
      (db.update as jest.Mock).mockReturnValue({
        set: setSpy,
        where: jest.fn().mockResolvedValue(undefined),
      });

      await service.grantSystemPermission(mockProjectId, mockUserId, 'viewer');

      expect(db.update).toHaveBeenCalled();
      expect(setSpy).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'viewer', grantedBy: null }),
      );
    });

    it('rejects the owner role', async () => {
      await expect(
        service.grantSystemPermission(mockProjectId, mockUserId, 'owner' as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('does NOT consult the granter (no self-admin check)', async () => {
      const roleSpy = jest.spyOn(service, 'getUserProjectRole');

      (db.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]),
      });
      (db.insert as jest.Mock).mockReturnValue({
        values: jest.fn().mockResolvedValue(undefined),
      });

      await service.grantSystemPermission(mockProjectId, mockUserId, 'guest');

      expect(roleSpy).not.toHaveBeenCalled();
    });
  });

  describe('revokePermission', () => {
    it('should revoke permission if revoker is admin', async () => {
      jest.spyOn(service, 'getUserProjectRole').mockResolvedValue('admin');

      const mockPermission = { role: 'contributor' };

      (db.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([mockPermission]),
      });

      (db.delete as jest.Mock).mockReturnValue({
        where: jest.fn().mockResolvedValue(undefined),
      });

      await service.revokePermission(mockProjectId, mockUserId, mockGrantedBy);

      expect(db.delete).toHaveBeenCalled();
    });

    it('should throw if permission not found', async () => {
      jest.spyOn(service, 'getUserProjectRole').mockResolvedValue('admin');

      (db.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]),
      });

      await expect(
        service.revokePermission(mockProjectId, mockUserId, mockGrantedBy),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw if trying to revoke owner permission', async () => {
      jest.spyOn(service, 'getUserProjectRole').mockResolvedValue('admin');

      const mockOwnerPermission = { role: 'owner' };

      (db.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([mockOwnerPermission]),
      });

      await expect(
        service.revokePermission(mockProjectId, mockUserId, mockGrantedBy),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('grantGroupPermission', () => {
    it('should grant group permission if granter is admin', async () => {
      jest.spyOn(service, 'getUserProjectRole').mockResolvedValue('admin');

      (db.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]),
      });

      (db.insert as jest.Mock).mockReturnValue({
        values: jest.fn().mockResolvedValue(undefined),
      });

      await service.grantGroupPermission(mockProjectId, mockGroupId, 'contributor', mockGrantedBy);

      expect(db.insert).toHaveBeenCalled();
    });

    it('should update existing group permission', async () => {
      jest.spyOn(service, 'getUserProjectRole').mockResolvedValue('admin');

      const mockExisting = { role: 'viewer' };

      (db.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([mockExisting]),
      });

      (db.update as jest.Mock).mockReturnValue({
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue(undefined),
      });

      await service.grantGroupPermission(mockProjectId, mockGroupId, 'admin', mockGrantedBy);

      expect(db.update).toHaveBeenCalled();
    });
  });

  describe('revokeGroupPermission', () => {
    it('should revoke group permission if revoker is admin', async () => {
      jest.spyOn(service, 'getUserProjectRole').mockResolvedValue('admin');

      const mockPermission = { role: 'contributor' };

      (db.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([mockPermission]),
      });

      (db.delete as jest.Mock).mockReturnValue({
        where: jest.fn().mockResolvedValue(undefined),
      });

      await service.revokeGroupPermission(mockProjectId, mockGroupId, mockGrantedBy);

      expect(db.delete).toHaveBeenCalled();
    });

    it('should throw if permission not found', async () => {
      jest.spyOn(service, 'getUserProjectRole').mockResolvedValue('admin');

      (db.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]),
      });

      await expect(
        service.revokeGroupPermission(mockProjectId, mockGroupId, mockGrantedBy),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getProjectUserPermissions', () => {
    it('should return all user permissions for a project', async () => {
      const mockPermissions = [
        {
          id: 'perm-1',
          projectId: mockProjectId,
          userId: 'user-1',
          role: 'admin',
          grantedBy: null,
          grantedAt: new Date(),
          user: {
            id: 'user-1',
            email: 'user1@example.com',
            name: null,
          },
        },
        {
          id: 'perm-2',
          projectId: mockProjectId,
          userId: 'user-2',
          role: 'viewer',
          grantedBy: null,
          grantedAt: new Date(),
          user: {
            id: 'user-2',
            email: 'user2@example.com',
            name: null,
          },
        },
      ];

      (db.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue(mockPermissions),
      });

      const result = await service.getProjectUserPermissions(mockProjectId);

      expect(result).toEqual(mockPermissions);
    });
  });

  describe('getProjectGroupPermissions', () => {
    it('should return all group permissions for a project', async () => {
      const mockPermissions = [
        {
          id: 'perm-1',
          projectId: mockProjectId,
          groupId: 'group-1',
          role: 'contributor',
          grantedBy: null,
          grantedAt: new Date(),
          group: {
            id: 'group-1',
            name: 'Engineering',
            description: 'Engineering team',
          },
        },
        {
          id: 'perm-2',
          projectId: mockProjectId,
          groupId: 'group-2',
          role: 'viewer',
          grantedBy: null,
          grantedAt: new Date(),
          group: {
            id: 'group-2',
            name: 'QA',
            description: null,
          },
        },
      ];

      (db.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue(mockPermissions),
      });

      const result = await service.getProjectGroupPermissions(mockProjectId);

      expect(result).toEqual(mockPermissions);
    });
  });

  describe('revokeSystemPermission', () => {
    it('deletes the membership row when present and not owner', async () => {
      // Existence check
      (db.select as jest.Mock).mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([
          { projectId: mockProjectId, userId: mockUserId, role: 'guest' },
        ]),
      });

      const deleteWhere = jest.fn().mockResolvedValue(undefined);
      (db.delete as jest.Mock).mockReturnValue({ where: deleteWhere });

      await service.revokeSystemPermission(mockProjectId, mockUserId);

      expect(db.delete).toHaveBeenCalled();
      expect(deleteWhere).toHaveBeenCalled();
    });

    it('throws NotFoundException when no membership exists', async () => {
      (db.select as jest.Mock).mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]),
      });

      await expect(
        service.revokeSystemPermission(mockProjectId, mockUserId),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when target role is owner', async () => {
      (db.select as jest.Mock).mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([
          { projectId: mockProjectId, userId: mockUserId, role: 'owner' },
        ]),
      });

      await expect(
        service.revokeSystemPermission(mockProjectId, mockUserId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('listUserProjectMemberships', () => {
    it('aggregates direct + group memberships, picks the highest role per project', async () => {
      const grantedAt = new Date('2026-04-30T00:00:00.000Z');

      // 1. directRows query
      (db.select as jest.Mock).mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([
          { projectId: 'p-1', role: 'guest', grantedAt },
        ]),
      });

      // 2. groupRows query (innerJoin chain)
      (db.select as jest.Mock).mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([
          { projectId: 'p-1', role: 'admin', grantedAt }, // higher than direct guest
          { projectId: 'p-2', role: 'viewer', grantedAt },
        ]),
      });

      // 3. projects in bulk
      (db.select as jest.Mock).mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([
          {
            id: 'p-1',
            owner: 'bffless',
            name: 'realestate-modern',
            displayName: 'Bella Charlesworth Real Estate',
          },
          {
            id: 'p-2',
            owner: 'bffless',
            name: 'salon',
            displayName: null,
          },
        ]),
      });

      // 4. domain mappings (active)
      (db.select as jest.Mock).mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([
          {
            projectId: 'p-1',
            domain: 'www.bellacharlesworth.com',
            domainType: 'custom',
            isPrimary: true,
            isActive: true,
            sslEnabled: true,
          },
          {
            projectId: 'p-2',
            domain: 'salon.sites.bffless.app',
            domainType: 'subdomain',
            isPrimary: false,
            isActive: true,
            sslEnabled: true,
          },
        ]),
      });

      // 5. owner emails in bulk
      (db.select as jest.Mock).mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([
          { projectId: 'p-1', email: 'james@example.com' },
          { projectId: 'p-2', email: 'salonowner@example.com' },
        ]),
      });

      const result = await service.listUserProjectMemberships(mockUserId);

      expect(result).toHaveLength(2);
      const p1 = result.find((m) => m.projectId === 'p-1')!;
      const p2 = result.find((m) => m.projectId === 'p-2')!;

      expect(p1.role).toBe('admin'); // group beat direct guest
      expect(p1.projectName).toBe('Bella Charlesworth Real Estate');
      expect(p1.projectSlug).toBe('bffless/realestate-modern');
      expect(p1.primaryUrl).toBe('https://www.bellacharlesworth.com');
      expect(p1.ownerEmail).toBe('james@example.com');

      expect(p2.role).toBe('viewer');
      expect(p2.projectName).toBe('salon'); // falls back to name when displayName null
      expect(p2.primaryUrl).toBe('https://salon.sites.bffless.app');
    });

    it('returns empty array when user has no memberships anywhere', async () => {
      (db.select as jest.Mock).mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([]),
      });
      (db.select as jest.Mock).mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([]),
      });

      const result = await service.listUserProjectMemberships(mockUserId);
      expect(result).toEqual([]);
    });

    it('handles a project with no domain mappings (primaryUrl=null)', async () => {
      const grantedAt = new Date();

      (db.select as jest.Mock).mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([
          { projectId: 'p-3', role: 'guest', grantedAt },
        ]),
      });
      (db.select as jest.Mock).mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([]),
      });
      (db.select as jest.Mock).mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([
          { id: 'p-3', owner: 'acme', name: 'unmapped', displayName: 'Unmapped' },
        ]),
      });
      (db.select as jest.Mock).mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([]),
      });
      (db.select as jest.Mock).mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([]),
      });

      const [m] = await service.listUserProjectMemberships(mockUserId);
      expect(m.primaryUrl).toBeNull();
      expect(m.ownerEmail).toBeNull();
    });
  });
});
