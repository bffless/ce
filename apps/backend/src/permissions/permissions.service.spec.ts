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
    it('should grant permission if granter is admin', async () => {
      jest.spyOn(service, 'getUserProjectRole').mockResolvedValue('admin');

      (db.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]), // No existing permission
      });

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

      await service.grantPermission(mockProjectId, mockUserId, 'admin', mockGrantedBy);

      expect(db.update).toHaveBeenCalled();
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
});
