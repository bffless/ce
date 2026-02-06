import { StorageMigrationService } from './migration.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { IStorageAdapter, FileMetadata } from '../storage.interface';
import { MigrationStatus } from './migration.interface';

describe('StorageMigrationService', () => {
  let service: StorageMigrationService;
  let mockSource: jest.Mocked<IStorageAdapter>;
  let mockTarget: jest.Mocked<IStorageAdapter>;
  let eventEmitter: EventEmitter2;

  beforeEach(() => {
    eventEmitter = new EventEmitter2();

    mockSource = {
      upload: jest.fn(),
      download: jest.fn().mockResolvedValue(Buffer.from('test content')),
      delete: jest.fn(),
      exists: jest.fn().mockResolvedValue(true),
      getUrl: jest.fn(),
      listKeys: jest.fn().mockResolvedValue(['file1.txt', 'file2.txt']),
      getMetadata: jest.fn().mockResolvedValue({
        key: 'file1.txt',
        size: 100,
        mimeType: 'text/plain',
      } as FileMetadata),
      testConnection: jest.fn().mockResolvedValue(true),
      deletePrefix: jest.fn().mockResolvedValue({ deleted: 0, failed: [] }),
    };

    mockTarget = {
      upload: jest.fn().mockResolvedValue('key'),
      download: jest.fn(),
      delete: jest.fn(),
      exists: jest.fn().mockResolvedValue(true),
      getUrl: jest.fn(),
      listKeys: jest.fn(),
      getMetadata: jest.fn(),
      testConnection: jest.fn().mockResolvedValue(true),
      deletePrefix: jest.fn().mockResolvedValue({ deleted: 0, failed: [] }),
    };

    service = new StorageMigrationService(eventEmitter);
  });

  const mockTargetConfig = { bucket: 'test-bucket', region: 'us-east-1' };

  describe('startMigration', () => {
    it('should start migration successfully', async () => {
      const jobId = await service.startMigration(
        mockSource,
        mockTarget,
        'minio',
        's3',
        mockTargetConfig,
      );

      expect(jobId).toMatch(/^migration-/);
      expect(mockTarget.testConnection).toHaveBeenCalled();
      expect(mockSource.listKeys).toHaveBeenCalled();
    });

    it('should throw if migration already in progress', async () => {
      await service.startMigration(mockSource, mockTarget, 'minio', 's3', mockTargetConfig);

      await expect(
        service.startMigration(mockSource, mockTarget, 'minio', 's3', mockTargetConfig),
      ).rejects.toThrow('Migration already in progress');
    });

    it('should throw if target connection fails', async () => {
      mockTarget.testConnection.mockResolvedValueOnce(false);

      await expect(
        service.startMigration(mockSource, mockTarget, 'minio', 's3', mockTargetConfig),
      ).rejects.toThrow('Cannot connect to target storage provider');
    });

    it('should calculate total bytes from all files', async () => {
      mockSource.getMetadata
        .mockResolvedValueOnce({ key: 'file1.txt', size: 100, mimeType: 'text/plain' })
        .mockResolvedValueOnce({ key: 'file2.txt', size: 200, mimeType: 'text/plain' });

      await service.startMigration(mockSource, mockTarget, 'minio', 's3', mockTargetConfig);

      const progress = service.getProgress();
      expect(progress?.totalBytes).toBe(300);
      expect(progress?.totalFiles).toBe(2);
    });

    it('should filter files by prefix when provided', async () => {
      await service.startMigration(mockSource, mockTarget, 'minio', 's3', mockTargetConfig, {
        filterPrefix: 'owner/repo/',
      });

      expect(mockSource.listKeys).toHaveBeenCalledWith('owner/repo/');
    });

    it('should store target config in job', async () => {
      await service.startMigration(mockSource, mockTarget, 'minio', 's3', mockTargetConfig);

      const job = service.getCurrentJob();
      expect(job?.targetConfig).toEqual(mockTargetConfig);
    });
  });

  describe('getProgress', () => {
    it('should return null when no migration is running', () => {
      expect(service.getProgress()).toBeNull();
    });

    it('should return progress during migration', async () => {
      await service.startMigration(mockSource, mockTarget, 'minio', 's3', mockTargetConfig);

      const progress = service.getProgress();
      expect(progress).not.toBeNull();
      expect(progress?.totalFiles).toBe(2);
      expect(progress?.status).toBe(MigrationStatus.IN_PROGRESS);
    });
  });

  describe('getCurrentJob', () => {
    it('should return null when no migration is running', () => {
      expect(service.getCurrentJob()).toBeNull();
    });

    it('should return job details during migration', async () => {
      await service.startMigration(mockSource, mockTarget, 'minio', 's3', mockTargetConfig);

      const job = service.getCurrentJob();
      expect(job).not.toBeNull();
      expect(job?.sourceProvider).toBe('minio');
      expect(job?.targetProvider).toBe('s3');
    });
  });

  describe('cancelMigration', () => {
    it('should cancel in-progress migration', async () => {
      await service.startMigration(mockSource, mockTarget, 'minio', 's3', mockTargetConfig);
      await service.cancelMigration();

      const progress = service.getProgress();
      expect(progress?.status).toBe(MigrationStatus.CANCELLED);
    });

    it('should throw if no migration to cancel', async () => {
      await expect(service.cancelMigration()).rejects.toThrow('No migration in progress');
    });
  });

  describe('calculateScope', () => {
    it('should calculate file count and total size', async () => {
      mockSource.getMetadata
        .mockResolvedValueOnce({ key: 'file1.txt', size: 100, mimeType: 'text/plain' })
        .mockResolvedValueOnce({ key: 'file2.txt', size: 200, mimeType: 'text/plain' });

      const scope = await service.calculateScope(mockSource);

      expect(scope.fileCount).toBe(2);
      expect(scope.totalBytes).toBe(300);
    });

    it('should format size correctly', async () => {
      mockSource.listKeys.mockResolvedValueOnce(['file1.txt']);
      mockSource.getMetadata.mockResolvedValueOnce({
        key: 'file1.txt',
        size: 1024 * 1024 * 10, // 10 MB
        mimeType: 'text/plain',
      });

      const scope = await service.calculateScope(mockSource);

      expect(scope.formattedSize).toBe('10.0 MB');
    });

    it('should filter by prefix', async () => {
      await service.calculateScope(mockSource, 'owner/repo/');

      expect(mockSource.listKeys).toHaveBeenCalledWith('owner/repo/');
    });

    it('should handle files that no longer exist', async () => {
      mockSource.getMetadata
        .mockResolvedValueOnce({ key: 'file1.txt', size: 100, mimeType: 'text/plain' })
        .mockRejectedValueOnce(new Error('File not found'));

      const scope = await service.calculateScope(mockSource);

      expect(scope.fileCount).toBe(2);
      expect(scope.totalBytes).toBe(100); // Only first file counted
    });

    it('should estimate duration', async () => {
      mockSource.listKeys.mockResolvedValueOnce(['file1.txt']);
      mockSource.getMetadata.mockResolvedValueOnce({
        key: 'file1.txt',
        size: 1024 * 1024 * 60, // 60 MB
        mimeType: 'text/plain',
      });

      const scope = await service.calculateScope(mockSource);

      expect(scope.estimatedDuration).toBe('1 minutes');
    });
  });

  describe('file migration', () => {
    it('should download from source and upload to target', async () => {
      const testData = Buffer.from('test file content');
      mockSource.download.mockResolvedValueOnce(testData);

      await service.startMigration(mockSource, mockTarget, 'minio', 's3', mockTargetConfig);

      // Wait for migration to process
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockSource.download).toHaveBeenCalled();
      expect(mockTarget.upload).toHaveBeenCalledWith(
        testData,
        expect.any(String),
        expect.objectContaining({ mimeType: 'text/plain' }),
      );
    });

    it('should verify file exists after upload when verifyIntegrity is enabled', async () => {
      await service.startMigration(mockSource, mockTarget, 'minio', 's3', mockTargetConfig, {
        verifyIntegrity: true,
      });

      // Wait for migration to process
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockTarget.exists).toHaveBeenCalled();
    });

    it('should retry on failure', async () => {
      mockSource.download
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(Buffer.from('test'));

      await service.startMigration(mockSource, mockTarget, 'minio', 's3', mockTargetConfig, {
        maxRetries: 3,
      });

      // Wait for migration to process with retries
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Should have retried
      expect(mockSource.download.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('should continue on error when continueOnError is true', async () => {
      mockSource.download
        .mockRejectedValueOnce(new Error('File 1 error'))
        .mockResolvedValueOnce(Buffer.from('file 2 content'));

      mockSource.getMetadata
        .mockResolvedValueOnce({ key: 'file1.txt', size: 100, mimeType: 'text/plain' })
        .mockResolvedValueOnce({ key: 'file2.txt', size: 100, mimeType: 'text/plain' });

      await service.startMigration(mockSource, mockTarget, 'minio', 's3', mockTargetConfig, {
        continueOnError: true,
        maxRetries: 0, // No retries for faster test
      });

      // Wait for migration to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      const progress = service.getProgress();
      expect(progress?.failedFiles).toBeGreaterThanOrEqual(1);
      expect(progress?.migratedFiles).toBeGreaterThanOrEqual(0);
    });
  });

  describe('resumeMigration', () => {
    it('should throw if no migration to resume', async () => {
      await expect(
        service.resumeMigration(mockSource, mockTarget),
      ).rejects.toThrow('No migration to resume');
    });

    it('should resume from checkpoint', async () => {
      // Start and cancel a migration
      await service.startMigration(mockSource, mockTarget, 'minio', 's3', mockTargetConfig);

      // Wait for some progress
      await new Promise((resolve) => setTimeout(resolve, 100));

      await service.cancelMigration();

      // Reset target mock for resume
      mockTarget.upload.mockClear();

      // Mock listKeys to return remaining files after checkpoint
      mockSource.listKeys.mockResolvedValueOnce(['file1.txt', 'file2.txt', 'file3.txt']);

      await service.resumeMigration(mockSource, mockTarget);

      const progress = service.getProgress();
      expect(progress?.status).toBe(MigrationStatus.IN_PROGRESS);
    });
  });

  describe('event emission', () => {
    it('should emit progress events', async () => {
      const progressHandler = jest.fn();
      eventEmitter.on('migration.progress', progressHandler);

      await service.startMigration(mockSource, mockTarget, 'minio', 's3', mockTargetConfig);

      // Wait for migration to complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(progressHandler).toHaveBeenCalled();
    });

    it('should emit complete event when finished', async () => {
      const completeHandler = jest.fn();
      eventEmitter.on('migration.complete', completeHandler);

      await service.startMigration(mockSource, mockTarget, 'minio', 's3', mockTargetConfig);

      // Wait for migration to complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(completeHandler).toHaveBeenCalled();
      expect(completeHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
        }),
      );
    });
  });
});
