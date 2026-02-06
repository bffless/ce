import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { UserGroupsController } from './user-groups.controller';
import { UserGroupsService } from './user-groups.service';
import { AuthService } from '../auth/auth.service';
import { CreateGroupDto, UpdateGroupDto, AddMemberDto } from './user-groups.dto';

describe('UserGroupsController', () => {
  let controller: UserGroupsController;
  let service: UserGroupsService;

  const mockUserId = '123e4567-e89b-12d3-a456-426614174000';
  const mockGroupId = '123e4567-e89b-12d3-a456-426614174001';
  const mockOtherUserId = '123e4567-e89b-12d3-a456-426614174002';

  const mockUser = {
    id: mockUserId,
    email: 'test@example.com',
    role: 'user',
  };

  const mockGroup = {
    id: mockGroupId,
    name: 'Test Group',
    description: 'Test description',
    createdBy: mockUserId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockUserDetails = {
    id: mockOtherUserId,
    email: 'member@example.com',
    role: 'user',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockMember = {
    id: 'member-id',
    groupId: mockGroupId,
    userId: mockOtherUserId,
    addedBy: mockUserId,
    addedAt: new Date(),
    user: mockUserDetails,
  };

  const mockUserGroupsService = {
    createGroup: jest.fn(),
    listUserGroups: jest.fn(),
    getGroup: jest.fn(),
    updateGroup: jest.fn(),
    deleteGroup: jest.fn(),
    addMember: jest.fn(),
    removeMember: jest.fn(),
    getGroupMembers: jest.fn(),
  };

  const mockAuthService = {
    getUserById: jest.fn(),
    getUserByEmail: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserGroupsController],
      providers: [
        {
          provide: UserGroupsService,
          useValue: mockUserGroupsService,
        },
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
      ],
    }).compile();

    controller = module.get<UserGroupsController>(UserGroupsController);
    service = module.get<UserGroupsService>(UserGroupsService);

    jest.clearAllMocks();
  });

  describe('createGroup', () => {
    it('should create a new group', async () => {
      const dto: CreateGroupDto = {
        name: 'Test Group',
        description: 'Test description',
      };

      mockUserGroupsService.createGroup.mockResolvedValue(mockGroup);

      const result = await controller.createGroup(dto, mockUser);

      expect(result).toEqual(mockGroup);
      expect(service.createGroup).toHaveBeenCalledWith(dto.name, dto.description, mockUserId);
    });

    it('should create group with null description when not provided', async () => {
      const dto: CreateGroupDto = {
        name: 'Test Group',
      };

      mockUserGroupsService.createGroup.mockResolvedValue({
        ...mockGroup,
        description: null,
      });

      const result = await controller.createGroup(dto, mockUser);

      expect(service.createGroup).toHaveBeenCalledWith(dto.name, null, mockUserId);
      expect(result.description).toBeNull();
    });
  });

  describe('listGroups', () => {
    it('should return list of groups', async () => {
      const groups = [mockGroup];
      mockUserGroupsService.listUserGroups.mockResolvedValue(groups);

      const result = await controller.listGroups(mockUser);

      expect(result).toEqual({ groups });
      expect(service.listUserGroups).toHaveBeenCalledWith(mockUserId);
    });

    it('should return empty list when user has no groups', async () => {
      mockUserGroupsService.listUserGroups.mockResolvedValue([]);

      const result = await controller.listGroups(mockUser);

      expect(result).toEqual({ groups: [] });
    });
  });

  describe('getGroup', () => {
    it('should return group with members', async () => {
      const groupWithMembers = {
        ...mockGroup,
        members: [mockMember],
      };

      mockUserGroupsService.getGroup.mockResolvedValue(groupWithMembers);

      const result = await controller.getGroup(mockGroupId);

      expect(result).toEqual(groupWithMembers);
      expect(service.getGroup).toHaveBeenCalledWith(mockGroupId);
    });

    it('should throw NotFoundException if group not found', async () => {
      mockUserGroupsService.getGroup.mockRejectedValue(
        new NotFoundException('User group not found'),
      );

      await expect(controller.getGroup(mockGroupId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateGroup', () => {
    it('should update group', async () => {
      const dto: UpdateGroupDto = {
        name: 'Updated Name',
        description: 'Updated description',
      };

      const updatedGroup = { ...mockGroup, ...dto };
      mockUserGroupsService.updateGroup.mockResolvedValue(updatedGroup);

      const result = await controller.updateGroup(mockGroupId, dto, mockUser);

      expect(result).toEqual(updatedGroup);
      expect(service.updateGroup).toHaveBeenCalledWith(mockGroupId, dto, mockUserId);
    });

    it('should throw ForbiddenException if not creator', async () => {
      const dto: UpdateGroupDto = { name: 'New Name' };

      mockUserGroupsService.updateGroup.mockRejectedValue(
        new ForbiddenException('Only the group creator can update the group'),
      );

      await expect(controller.updateGroup(mockGroupId, dto, mockUser)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('deleteGroup', () => {
    it('should delete group', async () => {
      mockUserGroupsService.deleteGroup.mockResolvedValue(undefined);

      await controller.deleteGroup(mockGroupId, mockUser);

      expect(service.deleteGroup).toHaveBeenCalledWith(mockGroupId, mockUserId);
    });

    it('should throw ForbiddenException if not creator', async () => {
      mockUserGroupsService.deleteGroup.mockRejectedValue(
        new ForbiddenException('Only the group creator can delete the group'),
      );

      await expect(controller.deleteGroup(mockGroupId, mockUser)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('addMember', () => {
    it('should add member to group', async () => {
      const dto: AddMemberDto = { userId: mockOtherUserId };

      mockUserGroupsService.addMember.mockResolvedValue(undefined);

      await controller.addMember(mockGroupId, dto, mockUser);

      expect(service.addMember).toHaveBeenCalledWith(mockGroupId, mockOtherUserId, mockUserId);
    });

    it('should throw ConflictException if user already a member', async () => {
      const dto: AddMemberDto = { userId: mockOtherUserId };

      mockUserGroupsService.addMember.mockRejectedValue(
        new ConflictException('User is already a member of this group'),
      );

      await expect(controller.addMember(mockGroupId, dto, mockUser)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw ForbiddenException if not creator', async () => {
      const dto: AddMemberDto = { userId: mockOtherUserId };

      mockUserGroupsService.addMember.mockRejectedValue(
        new ForbiddenException('Only the group creator can add members'),
      );

      await expect(controller.addMember(mockGroupId, dto, mockUser)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('removeMember', () => {
    it('should remove member from group', async () => {
      mockUserGroupsService.removeMember.mockResolvedValue(undefined);

      await controller.removeMember(mockGroupId, mockOtherUserId, mockUser);

      expect(service.removeMember).toHaveBeenCalledWith(mockGroupId, mockOtherUserId, mockUserId);
    });

    it('should throw ForbiddenException if not creator', async () => {
      mockUserGroupsService.removeMember.mockRejectedValue(
        new ForbiddenException('Only the group creator can remove members'),
      );

      await expect(controller.removeMember(mockGroupId, mockOtherUserId, mockUser)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw NotFoundException if member not found', async () => {
      mockUserGroupsService.removeMember.mockRejectedValue(
        new NotFoundException('User is not a member of this group'),
      );

      await expect(controller.removeMember(mockGroupId, mockOtherUserId, mockUser)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getGroupMembers', () => {
    it('should return list of group members', async () => {
      const members = [mockMember];
      mockUserGroupsService.getGroupMembers.mockResolvedValue(members);

      const result = await controller.getGroupMembers(mockGroupId);

      expect(result).toEqual(members);
      expect(service.getGroupMembers).toHaveBeenCalledWith(mockGroupId);
    });

    it('should throw NotFoundException if group not found', async () => {
      mockUserGroupsService.getGroupMembers.mockRejectedValue(
        new NotFoundException('User group not found'),
      );

      await expect(controller.getGroupMembers(mockGroupId)).rejects.toThrow(NotFoundException);
    });
  });
});
