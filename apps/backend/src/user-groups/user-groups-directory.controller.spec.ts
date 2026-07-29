import { Test, TestingModule } from '@nestjs/testing';
import 'reflect-metadata';
import { UserGroupsDirectoryController } from './user-groups-directory.controller';
import { UserGroupsService } from './user-groups.service';
import { AuthService } from '../auth/auth.service';

describe('UserGroupsDirectoryController', () => {
  let controller: UserGroupsDirectoryController;

  const mockUserGroupsService = {
    searchGroupDirectory: jest.fn(),
    getMyGroups: jest.fn(),
  };

  const mockAuthService = {
    getUserById: jest.fn(),
    getUserByEmail: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserGroupsDirectoryController],
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

    controller = module.get<UserGroupsDirectoryController>(UserGroupsDirectoryController);

    jest.clearAllMocks();
  });

  it('delegates directory search to the service', async () => {
    mockUserGroupsService.searchGroupDirectory.mockResolvedValue({ groups: [] });
    await expect(controller.searchDirectory({ search: 'des', limit: 5 })).resolves.toEqual({
      groups: [],
    });
    expect(mockUserGroupsService.searchGroupDirectory).toHaveBeenCalledWith('des', 5);
  });

  it('returns the current user own memberships', async () => {
    mockUserGroupsService.getMyGroups.mockResolvedValue({ groups: [{ id: 'g1', name: 'Design' }] });
    await expect(controller.myGroups({ id: 'u1', email: 'e', role: 'user' })).resolves.toEqual({
      groups: [{ id: 'g1', name: 'Design' }],
    });
    expect(mockUserGroupsService.getMyGroups).toHaveBeenCalledWith('u1');
  });

  it('is NOT admin-gated (no roles metadata on controller or handlers)', () => {
    expect(Reflect.getMetadata('roles', UserGroupsDirectoryController)).toBeUndefined();
    expect(
      Reflect.getMetadata('roles', UserGroupsDirectoryController.prototype.searchDirectory),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata('roles', UserGroupsDirectoryController.prototype.myGroups),
    ).toBeUndefined();
  });
});
