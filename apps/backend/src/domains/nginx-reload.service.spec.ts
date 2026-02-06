import { Test, TestingModule } from '@nestjs/testing';
import { NginxReloadService } from './nginx-reload.service';
import * as fs from 'fs/promises';

// Mock fs/promises
jest.mock('fs/promises', () => ({
  copyFile: jest.fn(),
  unlink: jest.fn(),
  access: jest.fn(),
}));

describe('NginxReloadService', () => {
  let service: NginxReloadService;
  let mockCopyFile: jest.MockedFunction<typeof fs.copyFile>;
  let mockUnlink: jest.MockedFunction<typeof fs.unlink>;
  let mockAccess: jest.MockedFunction<typeof fs.access>;

  beforeEach(async () => {
    // Reset environment
    process.env.NGINX_RELOAD_WAIT_MS = '100'; // Reduce wait time for tests

    mockCopyFile = fs.copyFile as jest.MockedFunction<typeof fs.copyFile>;
    mockUnlink = fs.unlink as jest.MockedFunction<typeof fs.unlink>;
    mockAccess = fs.access as jest.MockedFunction<typeof fs.access>;

    // Default mock implementations
    mockCopyFile.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValue(undefined);
    mockAccess.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [NginxReloadService],
    }).compile();

    service = module.get<NginxReloadService>(NginxReloadService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.NGINX_RELOAD_WAIT_MS;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validateAndReload', () => {
    it('should copy config file, delete temp, and return success', async () => {
      const tempPath = '/tmp/domain-1.conf';
      const finalPath = '/etc/nginx/sites-enabled/domain-1.conf';

      const result = await service.validateAndReload(tempPath, finalPath);

      expect(mockCopyFile).toHaveBeenCalledWith(tempPath, finalPath);
      expect(mockUnlink).toHaveBeenCalledWith(tempPath);
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return failure on copyFile error', async () => {
      const tempPath = '/tmp/domain-1.conf';
      const finalPath = '/etc/nginx/sites-enabled/domain-1.conf';

      mockCopyFile.mockRejectedValue(new Error('Permission denied'));

      const result = await service.validateAndReload(tempPath, finalPath);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Permission denied');
    });

    it('should wait for watcher to process', async () => {
      const tempPath = '/tmp/domain-1.conf';
      const finalPath = '/etc/nginx/sites-enabled/domain-1.conf';

      const startTime = Date.now();
      await service.validateAndReload(tempPath, finalPath);
      const elapsed = Date.now() - startTime;

      // Should wait at least close to the configured time (100ms in test)
      // Use 90ms threshold to account for timer imprecision in CI environments
      expect(elapsed).toBeGreaterThanOrEqual(90);
    });
  });

  describe('removeConfigAndReload', () => {
    it('should delete config file and return success', async () => {
      const configPath = '/etc/nginx/sites-enabled/domain-1.conf';

      const result = await service.removeConfigAndReload(configPath);

      expect(mockAccess).toHaveBeenCalledWith(configPath);
      expect(mockUnlink).toHaveBeenCalledWith(configPath);
      expect(result.success).toBe(true);
    });

    it('should return success if file does not exist', async () => {
      const configPath = '/etc/nginx/sites-enabled/nonexistent.conf';
      const error: NodeJS.ErrnoException = new Error('ENOENT');
      error.code = 'ENOENT';
      mockAccess.mockRejectedValue(error);

      const result = await service.removeConfigAndReload(configPath);

      expect(result.success).toBe(true);
      expect(mockUnlink).not.toHaveBeenCalled();
    });

    it('should return failure on unexpected error', async () => {
      const configPath = '/etc/nginx/sites-enabled/domain-1.conf';
      mockUnlink.mockRejectedValue(new Error('Unexpected error'));

      const result = await service.removeConfigAndReload(configPath);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unexpected error');
    });

    it('should wait for watcher to process after delete', async () => {
      const configPath = '/etc/nginx/sites-enabled/domain-1.conf';

      const startTime = Date.now();
      await service.removeConfigAndReload(configPath);
      const elapsed = Date.now() - startTime;

      // Should wait at least close to the configured time (100ms in test)
      // Use 90ms threshold to account for timer imprecision in CI environments
      expect(elapsed).toBeGreaterThanOrEqual(90);
    });
  });
});
