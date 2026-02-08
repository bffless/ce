import { Test, TestingModule } from '@nestjs/testing';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { AssetSortField, SortOrder } from './assets.dto';

describe('AssetsController', () => {
  let controller: AssetsController;
  let service: jest.Mocked<AssetsService>;

  const mockUser = {
    id: 'user-id-123',
    email: 'test@example.com',
    role: 'user',
  };

  const mockAssetResponse = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    fileName: 'test.png',
    originalPath: 'uploads/test.png',
    storageKey: 'owner/repo/abc123/test.png',
    mimeType: 'image/png',
    size: 1024,
    repository: 'owner/repo',
    branch: 'main',
    commitSha: 'abc123',
    workflowName: 'CI',
    workflowRunId: '123',
    workflowRunNumber: 1,
    uploadedBy: 'user-id-123',
    organizationId: null,
    tags: ['test'],
    description: 'Test asset',
    deploymentId: null,
    isPublic: false,
    publicPath: null,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  };

  beforeEach(async () => {
    const mockAssetsService = {
      upload: jest.fn().mockResolvedValue(mockAssetResponse),
      batchUpload: jest.fn().mockResolvedValue({
        assets: [mockAssetResponse],
        failed: [],
      }),
      findAll: jest.fn().mockResolvedValue({
        data: [mockAssetResponse],
        meta: {
          page: 1,
          limit: 10,
          total: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      }),
      findById: jest.fn().mockResolvedValue(mockAssetResponse),
      download: jest.fn().mockResolvedValue({
        buffer: Buffer.from('test data'),
        fileName: 'test.png',
        mimeType: 'image/png',
      }),
      getUrl: jest.fn().mockResolvedValue({
        url: 'https://storage.example.com/test.png',
        expiresAt: '2025-01-01T01:00:00.000Z',
      }),
      update: jest.fn().mockResolvedValue(mockAssetResponse),
      delete: jest.fn().mockResolvedValue(undefined),
      batchDelete: jest.fn().mockResolvedValue(1),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AssetsController],
      providers: [
        {
          provide: AssetsService,
          useValue: mockAssetsService,
        },
      ],
    }).compile();

    controller = module.get<AssetsController>(AssetsController);
    service = module.get(AssetsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('upload', () => {
    const mockFile = {
      originalname: 'test.png',
      mimetype: 'image/png',
      buffer: Buffer.from('test data'),
      size: 1024,
    } as Express.Multer.File;

    const mockDto = {
      repository: 'owner/repo',
      branch: 'main',
      commitSha: 'abc123',
      description: 'Test upload',
      tags: 'test',
    };

    it('should upload a file and return response', async () => {
      const result = await controller.upload(mockFile, mockDto, mockUser);

      expect(result.message).toBe('Asset uploaded successfully');
      expect(result.data).toEqual(mockAssetResponse);
      expect(service.upload).toHaveBeenCalledWith(
        mockFile,
        expect.any(Object),
        mockUser.id,
        mockUser.role,
        undefined,
      );
    });

    it('should merge GitHub context from headers', async () => {
      await controller.upload(
        mockFile,
        {},
        mockUser,
        'owner/repo',
        'main',
        'abc123',
        'CI Pipeline',
      );

      expect(service.upload).toHaveBeenCalledWith(
        mockFile,
        expect.objectContaining({
          repository: 'owner/repo',
          branch: 'main',
          commitSha: 'abc123',
          workflowName: 'CI Pipeline',
        }),
        mockUser.id,
        mockUser.role,
        undefined,
      );
    });
  });

  describe('batchUpload', () => {
    const mockFiles = [
      {
        originalname: 'test1.png',
        mimetype: 'image/png',
        buffer: Buffer.from('test data 1'),
        size: 1024,
      } as Express.Multer.File,
      {
        originalname: 'test2.png',
        mimetype: 'image/png',
        buffer: Buffer.from('test data 2'),
        size: 2048,
      } as Express.Multer.File,
    ];

    it('should upload multiple files', async () => {
      const result = await controller.batchUpload(mockFiles, {}, mockUser);

      expect(result.message).toContain('uploaded successfully');
      expect(result.uploadedCount).toBe(1);
      expect(service.batchUpload).toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    const mockQuery = {
      page: 1,
      limit: 10,
      sortBy: AssetSortField.CREATED_AT,
      sortOrder: SortOrder.DESC,
    };

    it('should return paginated assets', async () => {
      const result = await controller.findAll(mockUser, mockQuery);

      expect(result.data).toHaveLength(1);
      expect(result.meta.page).toBe(1);
      expect(service.findAll).toHaveBeenCalledWith(mockQuery, mockUser.id, mockUser.role, undefined);
    });
  });

  describe('findOne', () => {
    it('should return asset details', async () => {
      const result = await controller.findOne(mockUser, mockAssetResponse.id);

      expect(result.data).toEqual(mockAssetResponse);
      expect(service.findById).toHaveBeenCalledWith(
        mockAssetResponse.id,
        mockUser.id,
        mockUser.role,
        undefined,
      );
    });
  });

  describe('download', () => {
    it('should download asset file', async () => {
      const mockResponse = {
        set: jest.fn(),
        send: jest.fn(),
      } as any;

      await controller.download(mockUser, mockAssetResponse.id, mockResponse);

      expect(mockResponse.set).toHaveBeenCalledWith(
        expect.objectContaining({
          'Content-Type': 'image/png',
        }),
      );
      expect(mockResponse.send).toHaveBeenCalled();
    });
  });

  describe('getUrl', () => {
    it('should return presigned URL', async () => {
      const result = await controller.getUrl(mockUser, mockAssetResponse.id);

      expect(result.url).toBe('https://storage.example.com/test.png');
      expect(result.expiresAt).toBeDefined();
    });
  });

  describe('update', () => {
    it('should update asset metadata', async () => {
      const updateDto = { description: 'Updated description' };

      const result = await controller.update(mockUser, mockAssetResponse.id, updateDto);

      expect(result.message).toBe('Asset updated successfully');
      expect(result.data).toEqual(mockAssetResponse);
      expect(service.update).toHaveBeenCalledWith(
        mockAssetResponse.id,
        updateDto,
        mockUser.id,
        mockUser.role,
        undefined,
      );
    });
  });

  describe('remove', () => {
    it('should delete asset', async () => {
      const result = await controller.remove(mockUser, mockAssetResponse.id);

      expect(result.message).toBe('Asset deleted successfully');
      expect(service.delete).toHaveBeenCalledWith(
        mockAssetResponse.id,
        mockUser.id,
        mockUser.role,
        undefined,
      );
    });
  });

  describe('batchRemove', () => {
    it('should delete multiple assets', async () => {
      const result = await controller.batchRemove(mockUser, { ids: [mockAssetResponse.id] });

      expect(result.message).toContain('deleted successfully');
      expect(result.deletedCount).toBe(1);
      expect(service.batchDelete).toHaveBeenCalledWith(
        [mockAssetResponse.id],
        mockUser.id,
        mockUser.role,
        undefined,
      );
    });
  });
});
