import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { STORAGE_ADAPTER } from '../storage/storage.interface';
import { UsageReporterService } from '../platform/usage-reporter.service';

// Mock the database
jest.mock('../db/client', () => ({
  db: {
    insert: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    returning: jest.fn(),
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    orderBy: jest.fn(),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    execute: jest.fn(),
  },
}));

// Import mocked modules
import { db } from '../db/client';

// Type the mocked db
const mockDb = db as any;

const mockStorageAdapter = {
  deletePrefix: jest.fn().mockResolvedValue({ deleted: 0, failed: [] }),
};

const mockUsageReporter = {
  reportDelete: jest.fn().mockResolvedValue(undefined),
  reportUpload: jest.fn().mockResolvedValue(undefined),
  isEnabled: jest.fn().mockReturnValue(false),
};

describe('ProjectsService', () => {
  let service: ProjectsService;

  const mockProject = {
    id: 'project-uuid-1234',
    owner: 'testowner',
    name: 'testrepo',
    displayName: 'Test Repository',
    description: 'A test repository',
    isPublic: false,
    unauthorizedBehavior: 'not_found',
    requiredRole: 'authenticated',
    settings: {},
    defaultProxyRuleSetId: null,
    createdBy: 'user-uuid-1234',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  const mockPublicProject = {
    id: 'project-uuid-5678',
    owner: 'opensource',
    name: 'publicrepo',
    displayName: 'Public Repository',
    description: 'A public repository',
    isPublic: true,
    unauthorizedBehavior: 'not_found',
    requiredRole: 'authenticated',
    settings: {},
    defaultProxyRuleSetId: null,
    createdBy: 'user-uuid-5678',
    createdAt: new Date('2024-01-02'),
    updatedAt: new Date('2024-01-02'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: STORAGE_ADAPTER, useValue: mockStorageAdapter },
        { provide: UsageReporterService, useValue: mockUsageReporter },
      ],
    }).compile();

    service = module.get<ProjectsService>(ProjectsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findOrCreateProject', () => {
    it('should return existing project if found', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockProject]),
          }),
        }),
      });

      const result = await service.findOrCreateProject('testowner', 'testrepo', 'user-uuid-1234');

      expect(result).toEqual(mockProject);
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('should create new project if not found', async () => {
      // First call - check if exists
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      // Mock insert
      const newProject = {
        ...mockProject,
        displayName: 'testrepo', // Uses name as displayName
        description: null,
      };
      mockDb.insert.mockReturnValueOnce({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([newProject]),
        }),
      });

      const result = await service.findOrCreateProject('testowner', 'testrepo', 'user-uuid-1234');

      expect(result).toEqual(newProject);
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should create project with default settings', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      const newProject = {
        id: 'new-uuid',
        owner: 'newowner',
        name: 'newrepo',
        displayName: 'newrepo',
        description: null,
        isPublic: false, // Default to private
        settings: {},
        createdBy: 'user-uuid-1234',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockDb.insert.mockReturnValueOnce({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([newProject]),
        }),
      });

      const result = await service.findOrCreateProject('newowner', 'newrepo', 'user-uuid-1234');

      expect(result.isPublic).toBe(false);
      expect(result.settings).toEqual({});
    });
  });

  describe('getProjectById', () => {
    it('should return a project by ID', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockProject]),
          }),
        }),
      });

      const result = await service.getProjectById('project-uuid-1234');

      expect(result).toEqual(mockProject);
      expect(result.id).toBe('project-uuid-1234');
    });

    it('should throw NotFoundException if project not found', async () => {
      // First call in test
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(service.getProjectById('nonexistent-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getProjectByOwnerName', () => {
    it('should return a project by owner and name', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockProject]),
          }),
        }),
      });

      const result = await service.getProjectByOwnerName('testowner', 'testrepo');

      expect(result).toEqual(mockProject);
      expect(result.owner).toBe('testowner');
      expect(result.name).toBe('testrepo');
    });

    it('should throw NotFoundException if project not found', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(service.getProjectByOwnerName('owner', 'repo')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('listUserProjects', () => {
    it('should return all projects created by a user', async () => {
      const userProjects = [mockProject, mockPublicProject];

      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockResolvedValue(userProjects),
          }),
        }),
      });

      const result = await service.listUserProjects('user-uuid-1234');

      expect(result).toHaveLength(2);
      expect(result).toEqual(userProjects);
    });

    it('should return empty array if user has no projects', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      const result = await service.listUserProjects('user-with-no-projects');

      expect(result).toEqual([]);
    });
  });

  describe('updateProject', () => {
    it('should update project settings', async () => {
      const updatedProject = {
        ...mockProject,
        displayName: 'Updated Name',
        isPublic: true,
      };

      // Check if exists
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockProject]),
          }),
        }),
      });

      // Update
      mockDb.update.mockReturnValueOnce({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([updatedProject]),
          }),
        }),
      });

      const result = await service.updateProject('project-uuid-1234', {
        displayName: 'Updated Name',
        isPublic: true,
      });

      expect(result.displayName).toBe('Updated Name');
      expect(result.isPublic).toBe(true);
    });

    it('should throw NotFoundException if project not found', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(
        service.updateProject('nonexistent-id', { displayName: 'New Name' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should update only provided fields', async () => {
      const updatedProject = {
        ...mockProject,
        description: 'New description',
      };

      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockProject]),
          }),
        }),
      });

      mockDb.update.mockReturnValueOnce({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([updatedProject]),
          }),
        }),
      });

      const result = await service.updateProject('project-uuid-1234', {
        description: 'New description',
      });

      expect(result.description).toBe('New description');
      expect(result.displayName).toBe(mockProject.displayName); // Unchanged
    });
  });

  describe('deleteProject', () => {
    const setupDeleteMocks = (totalSize: string | null = '0') => {
      // 1. select project by id
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockProject]),
          }),
        }),
      });

      // 2. sum(assets.size) query
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([{ totalSize }]),
        }),
      });

      // 3. delete deployment_aliases
      mockDb.delete.mockReturnValueOnce({
        where: jest.fn().mockResolvedValue(undefined),
      });

      // 4. delete assets
      mockDb.delete.mockReturnValueOnce({
        where: jest.fn().mockResolvedValue(undefined),
      });

      // 5. update apiKeys (set projectId = null)
      mockDb.update.mockReturnValueOnce({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(undefined),
        }),
      });

      // 6. delete project
      mockDb.delete.mockReturnValueOnce({
        where: jest.fn().mockResolvedValue(undefined),
      });
    };

    it('should delete a project and clean up related data', async () => {
      setupDeleteMocks('1024');

      await expect(service.deleteProject('project-uuid-1234')).resolves.not.toThrow();
      expect(mockDb.delete).toHaveBeenCalled();
      expect(mockStorageAdapter.deletePrefix).toHaveBeenCalledWith('testowner/testrepo/');
      expect(mockUsageReporter.reportDelete).toHaveBeenCalledWith(1024);
    });

    it('should not report usage when no storage was freed', async () => {
      setupDeleteMocks('0');

      await expect(service.deleteProject('project-uuid-1234')).resolves.not.toThrow();
      expect(mockUsageReporter.reportDelete).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException if project not found', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(service.deleteProject('nonexistent-id')).rejects.toThrow(NotFoundException);
      expect(mockDb.delete).not.toHaveBeenCalled();
    });

    it('should succeed even if storage cleanup fails', async () => {
      setupDeleteMocks('0');
      mockStorageAdapter.deletePrefix.mockRejectedValueOnce(new Error('Storage error'));

      await expect(service.deleteProject('project-uuid-1234')).resolves.not.toThrow();
    });
  });

  describe('createProject', () => {
    it('should create a new project', async () => {
      // Check if exists
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      // Insert
      mockDb.insert.mockReturnValueOnce({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([mockProject]),
        }),
      });

      const result = await service.createProject({
        owner: 'testowner',
        name: 'testrepo',
        displayName: 'Test Repository',
        description: 'A test repository',
        isPublic: false,
        settings: {},
        createdBy: 'user-uuid-1234',
      });

      expect(result).toEqual(mockProject);
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should throw ConflictException if project already exists', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockProject]),
          }),
        }),
      });

      await expect(
        service.createProject({
          owner: 'testowner',
          name: 'testrepo',
          displayName: 'Test Repository',
          createdBy: 'user-uuid-1234',
        }),
      ).rejects.toThrow(ConflictException);
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('should use default values for optional fields', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      const projectWithDefaults = {
        ...mockProject,
        isPublic: false,
        settings: {},
      };

      mockDb.insert.mockReturnValueOnce({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([projectWithDefaults]),
        }),
      });

      const result = await service.createProject({
        owner: 'testowner',
        name: 'testrepo',
        displayName: 'Test Repository',
        createdBy: 'user-uuid-1234',
      });

      expect(result.isPublic).toBe(false);
      expect(result.settings).toEqual({});
    });
  });

  describe('projectExists', () => {
    it('should return true if project exists', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ id: 'project-uuid-1234' }]),
          }),
        }),
      });

      const result = await service.projectExists('testowner', 'testrepo');

      expect(result).toBe(true);
    });

    it('should return false if project does not exist', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      const result = await service.projectExists('nonexistent', 'repo');

      expect(result).toBe(false);
    });
  });

  describe('getMyRepositories', () => {
    const userId = 'user-uuid-1234';

    it('should return owned repositories', async () => {
      const ownedRepos = [
        {
          id: 'proj-1',
          owner: 'testowner',
          name: 'repo1',
          permissionType: 'owner',
          role: 'owner',
        },
      ];

      // Mock owned repos query
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue(ownedRepos),
            }),
          }),
        }),
      });

      // Mock direct permissions query (empty)
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
      });

      // Mock group permissions query (empty)
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            innerJoin: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                orderBy: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue([]),
                }),
              }),
            }),
          }),
        }),
      });

      const result = await service.getMyRepositories(userId);

      expect(result.total).toBe(1);
      expect(result.repositories).toHaveLength(1);
      expect(result.repositories[0].permissionType).toBe('owner');
    });

    it('should deduplicate repositories across permission types', async () => {
      const projectId = 'proj-1';

      // User owns the project
      const ownedRepos = [
        {
          id: projectId,
          owner: 'testowner',
          name: 'repo1',
          permissionType: 'owner',
          role: 'owner',
        },
      ];

      // User also has direct permission (should be deduplicated)
      const directRepos = [
        {
          id: projectId,
          owner: 'testowner',
          name: 'repo1',
          permissionType: 'direct',
          role: 'admin',
        },
      ];

      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue(ownedRepos),
            }),
          }),
        }),
      });

      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue(directRepos),
              }),
            }),
          }),
        }),
      });

      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            innerJoin: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                orderBy: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue([]),
                }),
              }),
            }),
          }),
        }),
      });

      const result = await service.getMyRepositories(userId);

      // Should only return 1 repo (deduplicated)
      expect(result.total).toBe(1);
      expect(result.repositories).toHaveLength(1);
      // Should use owner permission (higher priority)
      expect(result.repositories[0].permissionType).toBe('owner');
    });

    it('should sort repositories alphabetically by name', async () => {
      const repos = [
        { id: 'proj-3', owner: 'test', name: 'zebra', permissionType: 'owner', role: 'owner' },
        { id: 'proj-1', owner: 'test', name: 'alpha', permissionType: 'owner', role: 'owner' },
        { id: 'proj-2', owner: 'test', name: 'beta', permissionType: 'owner', role: 'owner' },
      ];

      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue(repos),
            }),
          }),
        }),
      });

      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
      });

      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            innerJoin: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                orderBy: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue([]),
                }),
              }),
            }),
          }),
        }),
      });

      const result = await service.getMyRepositories(userId);

      expect(result.repositories[0].name).toBe('alpha');
      expect(result.repositories[1].name).toBe('beta');
      expect(result.repositories[2].name).toBe('zebra');
    });

    it('should limit to 100 repositories', async () => {
      // Create 150 repos
      const manyRepos = Array.from({ length: 150 }, (_, i) => ({
        id: `proj-${i}`,
        owner: 'test',
        name: `repo${i}`,
        permissionType: 'owner',
        role: 'owner',
      }));

      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue(manyRepos),
            }),
          }),
        }),
      });

      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
      });

      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            innerJoin: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                orderBy: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue([]),
                }),
              }),
            }),
          }),
        }),
      });

      const result = await service.getMyRepositories(userId);

      // Should be limited to 100
      expect(result.repositories.length).toBeLessThanOrEqual(100);
    });
  });

  describe('getRepositoryFeed', () => {
    it('should return paginated repositories for authenticated user', async () => {
      const mockResults = [
        {
          id: 'proj-1',
          owner: 'testowner',
          name: 'repo1',
          display_name: 'Repository 1',
          description: 'Test repo',
          is_public: false,
          permission_type: 'owner',
          role: 'owner',
          deployment_count: 5,
          storage_bytes: 1024000,
          last_deployed_at: new Date('2024-01-15'),
          created_at: new Date('2024-01-01'),
          updated_at: new Date('2024-01-15'),
        },
      ];

      mockDb.execute.mockResolvedValueOnce(mockResults);
      mockDb.execute.mockResolvedValueOnce([{ total: 1 }]);

      const result = await service.getRepositoryFeed('user-uuid-1234', {
        page: 1,
        limit: 20,
      });

      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.total).toBe(1);
      expect(result.repositories).toHaveLength(1);
      expect(result.repositories[0].id).toBe('proj-1');
      expect(result.repositories[0].stats.deploymentCount).toBe(5);
      expect(result.repositories[0].stats.storageBytes).toBe(1024000);
    });

    it('should return only public repositories for anonymous users', async () => {
      const mockResults = [
        {
          id: 'proj-public',
          owner: 'opensource',
          name: 'public-repo',
          display_name: 'Public Repo',
          description: 'Public test repo',
          is_public: true,
          permission_type: 'public',
          role: null,
          deployment_count: 10,
          storage_bytes: 2048000,
          last_deployed_at: new Date('2024-01-20'),
          created_at: new Date('2024-01-01'),
          updated_at: new Date('2024-01-20'),
        },
      ];

      mockDb.execute.mockResolvedValueOnce(mockResults);
      mockDb.execute.mockResolvedValueOnce([{ total: 1 }]);

      const result = await service.getRepositoryFeed(null, {
        page: 1,
        limit: 20,
      });

      expect(result.repositories).toHaveLength(1);
      expect(result.repositories[0].isPublic).toBe(true);
      expect(result.repositories[0].permissionType).toBe('public');
      expect(result.repositories[0].role).toBeNull();
    });

    it('should apply search filter', async () => {
      mockDb.execute.mockResolvedValueOnce([]);
      mockDb.execute.mockResolvedValueOnce([{ total: 0 }]);

      await service.getRepositoryFeed('user-uuid-1234', {
        page: 1,
        limit: 20,
        search: 'testquery',
      });

      // Verify execute was called (search applied in SQL)
      expect(mockDb.execute).toHaveBeenCalled();
    });

    it('should apply custom sorting', async () => {
      mockDb.execute.mockResolvedValueOnce([]);
      mockDb.execute.mockResolvedValueOnce([{ total: 0 }]);

      await service.getRepositoryFeed('user-uuid-1234', {
        page: 1,
        limit: 20,
        sortBy: 'name',
        order: 'asc',
      });

      expect(mockDb.execute).toHaveBeenCalled();
    });

    it('should enforce maximum limit of 100', async () => {
      mockDb.execute.mockResolvedValueOnce([]);
      mockDb.execute.mockResolvedValueOnce([{ total: 0 }]);

      const result = await service.getRepositoryFeed('user-uuid-1234', {
        page: 1,
        limit: 500, // Request more than max
      });

      // Limit should be capped at 100
      expect(result.limit).toBe(100);
    });

    it('should calculate pagination correctly', async () => {
      mockDb.execute.mockResolvedValueOnce([]);
      mockDb.execute.mockResolvedValueOnce([{ total: 0 }]);

      const result = await service.getRepositoryFeed('user-uuid-1234', {
        page: 3,
        limit: 20,
      });

      expect(result.page).toBe(3);
      expect(result.limit).toBe(20);
      // Offset should be (3-1) * 20 = 40 (checked in SQL)
    });

    it('should convert storage bytes to MB', async () => {
      const mockResults = [
        {
          id: 'proj-1',
          owner: 'test',
          name: 'repo',
          display_name: 'Repo',
          description: null,
          is_public: false,
          permission_type: 'owner',
          role: 'owner',
          deployment_count: 1,
          storage_bytes: 10485760, // 10 MB
          last_deployed_at: new Date(),
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      mockDb.execute.mockResolvedValueOnce(mockResults);
      mockDb.execute.mockResolvedValueOnce([{ total: 1 }]);

      const result = await service.getRepositoryFeed('user-uuid-1234', {});

      expect(result.repositories[0].stats.storageBytes).toBe(10485760);
      expect(result.repositories[0].stats.storageMB).toBe(10);
    });
  });
});
