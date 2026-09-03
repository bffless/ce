import { Test, TestingModule } from '@nestjs/testing';
import { NginxReloadService } from './nginx-reload.service';
import * as fs from 'fs/promises';

// Mock fs/promises
jest.mock('fs/promises', () => ({
  copyFile: jest.fn(),
  rename: jest.fn(),
  unlink: jest.fn(),
  access: jest.fn(),
}));

describe('NginxReloadService', () => {
  let service: NginxReloadService;
  let mockCopyFile: jest.MockedFunction<typeof fs.copyFile>;
  let mockRename: jest.MockedFunction<typeof fs.rename>;
  let mockUnlink: jest.MockedFunction<typeof fs.unlink>;
  let mockAccess: jest.MockedFunction<typeof fs.access>;

  beforeEach(async () => {
    // Reset environment
    process.env.NGINX_RELOAD_WAIT_MS = '100'; // Reduce wait time for tests

    mockCopyFile = fs.copyFile as jest.MockedFunction<typeof fs.copyFile>;
    mockRename = fs.rename as jest.MockedFunction<typeof fs.rename>;
    mockUnlink = fs.unlink as jest.MockedFunction<typeof fs.unlink>;
    mockAccess = fs.access as jest.MockedFunction<typeof fs.access>;

    // Default mock implementations
    mockCopyFile.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
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
    it('renames the temp file into place (atomic on one filesystem) and returns success', async () => {
      const tempPath = '/etc/nginx/sites-enabled/.domain-1.conf.tmp';
      const finalPath = '/etc/nginx/sites-enabled/domain-1.conf';

      const result = await service.validateAndReload(tempPath, finalPath);

      expect(mockRename).toHaveBeenCalledWith(tempPath, finalPath);
      expect(mockCopyFile).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('falls back to copy + unlink when the temp file is on another filesystem (EXDEV)', async () => {
      const tempPath = '/tmp/domain-1.conf';
      const finalPath = '/etc/nginx/sites-enabled/domain-1.conf';
      mockRename.mockRejectedValueOnce(Object.assign(new Error('cross-device'), { code: 'EXDEV' }));

      const result = await service.validateAndReload(tempPath, finalPath);

      expect(mockCopyFile).toHaveBeenCalledWith(tempPath, finalPath);
      expect(mockUnlink).toHaveBeenCalledWith(tempPath);
      expect(result.success).toBe(true);
    });

    it('should return failure on a write error', async () => {
      const tempPath = '/tmp/domain-1.conf';
      const finalPath = '/etc/nginx/sites-enabled/domain-1.conf';

      mockRename.mockRejectedValue(new Error('Permission denied'));

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

  describe('writeConfigOnly', () => {
    it('renames the temp file into place and does NOT wait for nginx', async () => {
      const tempPath = '/etc/nginx/sites-enabled/.domain-bulk.conf.tmp';
      const finalPath = '/etc/nginx/sites-enabled/domain-bulk.conf';

      const startTime = Date.now();
      const result = await service.writeConfigOnly(tempPath, finalPath);
      const elapsed = Date.now() - startTime;

      expect(mockRename).toHaveBeenCalledWith(tempPath, finalPath);
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      // Must return well before NGINX_RELOAD_WAIT_MS (100ms in test) — otherwise
      // the bulk-write speedup at startup is defeated.
      expect(elapsed).toBeLessThan(50);
    });

    it('returns failure on a write error without throwing', async () => {
      mockRename.mockRejectedValueOnce(new Error('disk full'));

      const result = await service.writeConfigOnly('/etc/nginx/.x.conf.tmp', '/etc/nginx/x.conf');

      expect(result.success).toBe(false);
      expect(result.error).toBe('disk full');
      // Temp file should NOT be unlinked when the move failed (would mask the original error)
      expect(mockUnlink).not.toHaveBeenCalled();
    });
  });

  describe('waitForReload', () => {
    it('waits for the configured NGINX_RELOAD_WAIT_MS', async () => {
      const startTime = Date.now();
      await service.waitForReload();
      const elapsed = Date.now() - startTime;

      // 100ms configured in beforeEach; allow 90ms threshold for timer imprecision
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
