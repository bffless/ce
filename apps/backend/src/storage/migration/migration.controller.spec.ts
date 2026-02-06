import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { MigrationController } from './migration.controller';
import { StorageMigrationService } from './migration.service';
import { SetupService } from '../../setup/setup.service';
import { STORAGE_ADAPTER, IStorageAdapter } from '../storage.interface';
import { StorageModule } from '../storage.module';
import {
  MigrationStatus,
  MigrationProgress,
  MigrationJob,
  MigrationScope,
  MigrationOptions,
} from './migration.interface';
import { SessionAuthGuard } from '../../auth/session-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';

// Mock StorageModule.createAdapter
jest.mock('../storage.module', () => ({
  StorageModule: {
    createAdapter: jest.fn(),
  },
}));

describe('MigrationController', () => {
  let controller: MigrationController;
  let migrationService: jest.Mocked<StorageMigrationService>;
  let setupService: jest.Mocked<SetupService>;
  let mockCurrentStorage: jest.Mocked<IStorageAdapter>;
  let mockTargetStorage: jest.Mocked<IStorageAdapter>;

  // Mock guards
  const mockSessionAuthGuard = { canActivate: jest.fn().mockReturnValue(true) };
  const mockRolesGuard = { canActivate: jest.fn().mockReturnValue(true) };

  const createMockProgress = (
    status: MigrationStatus = MigrationStatus.IN_PROGRESS,
  ): MigrationProgress => ({
    status,
    totalFiles: 100,
    migratedFiles: 50,
    failedFiles: 0,
    skippedFiles: 0,
    totalBytes: 1024 * 1024 * 50,
    migratedBytes: 1024 * 1024 * 25,
    startedAt: new Date(),
    currentFile: 'test-file.txt',
    errors: [],
    canResume: true,
  });

  const createMockJob = (
    status: MigrationStatus = MigrationStatus.IN_PROGRESS,
  ): MigrationJob => ({
    id: 'job-123',
    sourceProvider: 'local',
    targetProvider: 's3',
    targetConfig: { bucket: 'test', region: 'us-east-1' },
    status,
    options: {},
    progress: createMockProgress(status),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  beforeEach(async () => {
    mockCurrentStorage = {
      upload: jest.fn(),
      download: jest.fn(),
      delete: jest.fn(),
      exists: jest.fn(),
      getUrl: jest.fn(),
      listKeys: jest.fn(),
      getMetadata: jest.fn(),
      testConnection: jest.fn(),
      deletePrefix: jest.fn(),
    };

    mockTargetStorage = {
      upload: jest.fn(),
      download: jest.fn(),
      delete: jest.fn(),
      exists: jest.fn(),
      getUrl: jest.fn(),
      listKeys: jest.fn(),
      getMetadata: jest.fn(),
      testConnection: jest.fn().mockResolvedValue(true),
      deletePrefix: jest.fn(),
    };

    // Reset mock
    (StorageModule.createAdapter as jest.Mock).mockReturnValue(mockTargetStorage);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MigrationController],
      providers: [
        {
          provide: StorageMigrationService,
          useValue: {
            calculateScope: jest.fn(),
            startMigration: jest.fn(),
            getProgress: jest.fn(),
            getCurrentJob: jest.fn(),
            cancelMigration: jest.fn(),
            resumeMigration: jest.fn(),
          },
        },
        {
          provide: SetupService,
          useValue: {
            getSystemConfig: jest.fn(),
          },
        },
        {
          provide: STORAGE_ADAPTER,
          useValue: mockCurrentStorage,
        },
      ],
    })
      .overrideGuard(SessionAuthGuard)
      .useValue(mockSessionAuthGuard)
      .overrideGuard(RolesGuard)
      .useValue(mockRolesGuard)
      .compile();

    controller = module.get<MigrationController>(MigrationController);
    migrationService = module.get(StorageMigrationService);
    setupService = module.get(SetupService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('calculateScope', () => {
    it('should calculate migration scope', async () => {
      const mockScope: MigrationScope = {
        fileCount: 100,
        totalBytes: 1024 * 1024 * 50,
        formattedSize: '50 MB',
        estimatedDuration: '5 minutes',
      };
      migrationService.calculateScope.mockResolvedValue(mockScope);

      const result = await controller.calculateScope();

      expect(result).toEqual(mockScope);
      expect(migrationService.calculateScope).toHaveBeenCalledWith(mockCurrentStorage, undefined);
    });

    it('should pass prefix to calculateScope', async () => {
      const mockScope: MigrationScope = {
        fileCount: 10,
        totalBytes: 1024 * 1024,
        formattedSize: '1 MB',
        estimatedDuration: '30 seconds',
      };
      migrationService.calculateScope.mockResolvedValue(mockScope);

      const result = await controller.calculateScope('owner/repo');

      expect(result).toEqual(mockScope);
      expect(migrationService.calculateScope).toHaveBeenCalledWith(mockCurrentStorage, 'owner/repo');
    });
  });

  describe('startMigration', () => {
    const dto = {
      provider: 's3' as const,
      config: {
        bucket: 'test-bucket',
        region: 'us-east-1',
      },
    };

    it('should start migration successfully', async () => {
      setupService.getSystemConfig.mockResolvedValue({
        storageProvider: 'local',
      } as any);
      migrationService.startMigration.mockResolvedValue('job-123');

      const result = await controller.startMigration(dto);

      expect(result).toEqual({
        jobId: 'job-123',
        message: 'Migration started',
      });
      expect(StorageModule.createAdapter).toHaveBeenCalledWith({
        storageType: 's3',
        config: dto.config,
      });
      expect(mockTargetStorage.testConnection).toHaveBeenCalled();
      expect(migrationService.startMigration).toHaveBeenCalledWith(
        mockCurrentStorage,
        mockTargetStorage,
        'local',
        's3',
        dto.config,
        undefined,
      );
    });

    it('should throw if target connection fails', async () => {
      mockTargetStorage.testConnection.mockResolvedValue(false);

      await expect(controller.startMigration(dto)).rejects.toThrow(BadRequestException);
      await expect(controller.startMigration(dto)).rejects.toThrow(
        'Cannot connect to target storage provider',
      );
    });

    it('should use "unknown" as source provider if no config', async () => {
      setupService.getSystemConfig.mockResolvedValue(null);
      migrationService.startMigration.mockResolvedValue('job-456');

      const result = await controller.startMigration(dto);

      expect(result.jobId).toBe('job-456');
      expect(migrationService.startMigration).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'unknown',
        's3',
        dto.config,
        undefined,
      );
    });

    it('should pass migration options', async () => {
      setupService.getSystemConfig.mockResolvedValue({ storageProvider: 'local' } as any);
      migrationService.startMigration.mockResolvedValue('job-789');

      const dtoWithOptions = {
        ...dto,
        options: {
          concurrency: 10,
          verifyIntegrity: true,
        } as MigrationOptions,
      };

      await controller.startMigration(dtoWithOptions);

      expect(migrationService.startMigration).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'local',
        's3',
        dto.config,
        dtoWithOptions.options,
      );
    });
  });

  describe('getProgress', () => {
    it('should return current progress', async () => {
      const mockProgress = createMockProgress();
      migrationService.getProgress.mockReturnValue(mockProgress);

      const result = await controller.getProgress();

      expect(result).toEqual(mockProgress);
    });

    it('should return status none if no progress', async () => {
      migrationService.getProgress.mockReturnValue(null);

      const result = await controller.getProgress();

      expect(result).toEqual({ status: 'none' });
    });
  });

  describe('getJob', () => {
    it('should return current job details', async () => {
      const mockJob = createMockJob();
      migrationService.getCurrentJob.mockReturnValue(mockJob);

      const result = await controller.getJob();

      expect(result.id).toBe('job-123');
      expect(result.sourceProvider).toBe('local');
      expect(result.targetProvider).toBe('s3');
      expect(result.targetConfig).toEqual({ bucket: 'test', region: 'us-east-1' });
      expect(result.status).toBe(MigrationStatus.IN_PROGRESS);
    });

    it('should return status none if no job', async () => {
      migrationService.getCurrentJob.mockReturnValue(null);

      const result = await controller.getJob();

      expect(result).toEqual({ status: 'none' });
    });
  });

  describe('cancelMigration', () => {
    it('should cancel migration successfully', async () => {
      migrationService.cancelMigration.mockResolvedValue(undefined);

      const result = await controller.cancelMigration();

      expect(result).toEqual({ success: true });
      expect(migrationService.cancelMigration).toHaveBeenCalled();
    });
  });

  describe('resumeMigration', () => {
    it('should resume migration successfully', async () => {
      const mockJob = createMockJob(MigrationStatus.PAUSED);
      migrationService.getCurrentJob.mockReturnValue(mockJob);
      migrationService.resumeMigration.mockResolvedValue(undefined);

      const dto = {
        config: { bucket: 'test', region: 'us-east-1' },
      };

      const result = await controller.resumeMigration(dto);

      expect(result).toEqual({ success: true });
      expect(StorageModule.createAdapter).toHaveBeenCalledWith({
        storageType: 's3',
        config: dto.config,
      });
      expect(migrationService.resumeMigration).toHaveBeenCalledWith(
        mockCurrentStorage,
        mockTargetStorage,
      );
    });

    it('should throw if no migration to resume', async () => {
      migrationService.getCurrentJob.mockReturnValue(null);

      const dto = { config: {} };

      await expect(controller.resumeMigration(dto)).rejects.toThrow(BadRequestException);
      await expect(controller.resumeMigration(dto)).rejects.toThrow('No migration to resume');
    });
  });

  describe('completeMigration', () => {
    it('should throw if migration is not complete', async () => {
      migrationService.getProgress.mockReturnValue(createMockProgress(MigrationStatus.IN_PROGRESS));

      const dto = {
        provider: 's3',
        config: { bucket: 'test', region: 'us-east-1' },
      };

      await expect(controller.completeMigration(dto)).rejects.toThrow(BadRequestException);
      await expect(controller.completeMigration(dto)).rejects.toThrow('Migration is not complete');
    });

    it('should throw if progress is null', async () => {
      migrationService.getProgress.mockReturnValue(null);

      const dto = {
        provider: 's3',
        config: { bucket: 'test', region: 'us-east-1' },
      };

      await expect(controller.completeMigration(dto)).rejects.toThrow(BadRequestException);
    });
  });
});
