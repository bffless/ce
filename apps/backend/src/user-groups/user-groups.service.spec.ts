import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { UserGroupsService } from './user-groups.service';

// Mock db client with factory function
jest.mock('../db/client', () => ({
  db: {
    insert: jest.fn(),
    select: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
}));

// Mock schema objects
jest.mock('../db/schema', () => ({
  userGroups: {},
  userGroupMembers: {},
  users: {},
}));

import { db } from '../db/client';

describe('UserGroupsService', () => {
  let service: UserGroupsService;

  const mockUserId = '123e4567-e89b-12d3-a456-426614174000';
  const mockGroupId = '123e4567-e89b-12d3-a456-426614174001';
  const mockOtherUserId = '123e4567-e89b-12d3-a456-426614174002';

  const mockGroup = {
    id: mockGroupId,
    name: 'Test Group',
    description: 'Test description',
    createdBy: mockUserId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockUser = {
    id: mockUserId,
    email: 'test@example.com',
    role: 'user',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [UserGroupsService],
    }).compile();

    service = module.get<UserGroupsService>(UserGroupsService);

    // Reset all mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createGroup', () => {
    it('should create a new group', async () => {
      const insertMock = jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([mockGroup]),
        }),
      });

      (db.insert as jest.Mock).mockReturnValue(insertMock());

      const result = await service.createGroup('Test Group', 'Test description', mockUserId);

      expect(result).toEqual(mockGroup);
      expect(db.insert).toHaveBeenCalled();
    });
  });

  describe('getGroup', () => {
    it('should return a group with members', async () => {
      const mockMember = {
        id: 'member-id',
        groupId: mockGroupId,
        userId: mockUserId,
        addedBy: mockUserId,
        addedAt: new Date(),
        user: mockUser,
      };

      (db.select as jest.Mock).mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockGroup]),
          }),
        }),
      });

      (db.select as jest.Mock).mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([mockMember]),
          }),
        }),
      });

      const result = await service.getGroup(mockGroupId);

      expect(result).toEqual({
        ...mockGroup,
        members: [mockMember],
      });
    });

    it('should throw NotFoundException if group not found', async () => {
      (db.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(service.getGroup(mockGroupId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('listUserGroups', () => {
    it('should return all groups user created or is member of', async () => {
      const createdGroup = { ...mockGroup };
      const memberGroup = {
        id: 'other-group-id',
        name: 'Other Group',
        description: null,
        createdBy: mockOtherUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (db.select as jest.Mock).mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([createdGroup]),
        }),
      });

      (db.select as jest.Mock).mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([memberGroup]),
          }),
        }),
      });

      const result = await service.listUserGroups(mockUserId);

      expect(result).toHaveLength(2);
      expect(result).toContainEqual(createdGroup);
      expect(result).toContainEqual(memberGroup);
    });

    it('should deduplicate if user is both creator and member', async () => {
      (db.select as jest.Mock).mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([mockGroup]),
        }),
      });

      (db.select as jest.Mock).mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([mockGroup]),
          }),
        }),
      });

      const result = await service.listUserGroups(mockUserId);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(mockGroup);
    });
  });

  describe('updateGroup', () => {
    it('should update group name and description', async () => {
      const updates = { name: 'Updated Name', description: 'Updated description' };
      const updatedGroup = { ...mockGroup, ...updates };

      (db.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockGroup]),
          }),
        }),
      });

      (db.update as jest.Mock).mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([updatedGroup]),
          }),
        }),
      });

      const result = await service.updateGroup(mockGroupId, updates, mockUserId);

      expect(result).toEqual(updatedGroup);
      expect(db.update as jest.Mock).toHaveBeenCalled();
    });

    it('should throw NotFoundException if group not found', async () => {
      (db.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(
        service.updateGroup(mockGroupId, { name: 'New Name' }, mockUserId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if not creator', async () => {
      (db.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockGroup]),
          }),
        }),
      });

      await expect(
        service.updateGroup(mockGroupId, { name: 'New Name' }, mockOtherUserId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('deleteGroup', () => {
    it('should delete a group', async () => {
      (db.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockGroup]),
          }),
        }),
      });

      (db.delete as jest.Mock).mockReturnValue({
        where: jest.fn().mockResolvedValue(undefined),
      });

      await service.deleteGroup(mockGroupId, mockUserId);

      expect(db.delete as jest.Mock).toHaveBeenCalled();
    });

    it('should throw NotFoundException if group not found', async () => {
      (db.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(service.deleteGroup(mockGroupId, mockUserId)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if not creator', async () => {
      (db.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockGroup]),
          }),
        }),
      });

      await expect(service.deleteGroup(mockGroupId, mockOtherUserId)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('addMember', () => {
    it('should add a member to a group', async () => {
      (db.select as jest.Mock)
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockGroup]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockUser]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([]),
            }),
          }),
        });

      (db.insert as jest.Mock).mockReturnValue({
        values: jest.fn().mockResolvedValue(undefined),
      });

      await service.addMember(mockGroupId, mockOtherUserId, mockUserId);

      expect(db.insert as jest.Mock).toHaveBeenCalled();
    });

    it('should throw NotFoundException if group not found', async () => {
      (db.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(service.addMember(mockGroupId, mockOtherUserId, mockUserId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException if not creator', async () => {
      (db.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockGroup]),
          }),
        }),
      });

      await expect(
        service.addMember(mockGroupId, mockOtherUserId, mockOtherUserId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException if user not found', async () => {
      (db.select as jest.Mock)
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockGroup]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([]),
            }),
          }),
        });

      await expect(service.addMember(mockGroupId, mockOtherUserId, mockUserId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ConflictException if user already a member', async () => {
      const existingMember = {
        id: 'member-id',
        groupId: mockGroupId,
        userId: mockOtherUserId,
        addedBy: mockUserId,
        addedAt: new Date(),
      };

      (db.select as jest.Mock)
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockGroup]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockUser]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([existingMember]),
            }),
          }),
        });

      await expect(service.addMember(mockGroupId, mockOtherUserId, mockUserId)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('removeMember', () => {
    it('should remove a member from a group', async () => {
      const mockMember = {
        id: 'member-id',
        groupId: mockGroupId,
        userId: mockOtherUserId,
        addedBy: mockUserId,
        addedAt: new Date(),
      };

      (db.select as jest.Mock)
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockGroup]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockMember]),
            }),
          }),
        });

      (db.delete as jest.Mock).mockReturnValue({
        where: jest.fn().mockResolvedValue(undefined),
      });

      await service.removeMember(mockGroupId, mockOtherUserId, mockUserId);

      expect(db.delete as jest.Mock).toHaveBeenCalled();
    });

    it('should throw NotFoundException if group not found', async () => {
      (db.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(service.removeMember(mockGroupId, mockOtherUserId, mockUserId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException if not creator', async () => {
      (db.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockGroup]),
          }),
        }),
      });

      await expect(
        service.removeMember(mockGroupId, mockOtherUserId, mockOtherUserId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException if member not found', async () => {
      (db.select as jest.Mock)
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockGroup]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([]),
            }),
          }),
        });

      await expect(service.removeMember(mockGroupId, mockOtherUserId, mockUserId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getGroupMembers', () => {
    it('should return all members of a group', async () => {
      const mockMember = {
        id: 'member-id',
        groupId: mockGroupId,
        userId: mockUserId,
        addedBy: mockUserId,
        addedAt: new Date(),
        user: mockUser,
      };

      (db.select as jest.Mock)
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockGroup]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            innerJoin: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([mockMember]),
            }),
          }),
        });

      const result = await service.getGroupMembers(mockGroupId);

      expect(result).toEqual([mockMember]);
    });

    it('should throw NotFoundException if group not found', async () => {
      (db.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(service.getGroupMembers(mockGroupId)).rejects.toThrow(NotFoundException);
    });
  });
});
