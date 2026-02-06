import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { RedirectsService } from './redirects.service';
import { NginxConfigService } from './nginx-config.service';
import { NginxReloadService } from './nginx-reload.service';
import { SslCertificateService } from './ssl-certificate.service';

// Mock the database module
jest.mock('../db/client', () => ({
  db: {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    returning: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { db } = require('../db/client');

describe('RedirectsService', () => {
  let service: RedirectsService;
  let mockNginxConfigService: Partial<NginxConfigService>;
  let mockNginxReloadService: Partial<NginxReloadService>;
  let mockSslCertificateService: Partial<SslCertificateService>;

  beforeEach(async () => {
    // Reset all mocks
    jest.clearAllMocks();

    mockNginxConfigService = {
      generateRedirectConfig: jest.fn().mockResolvedValue('# nginx config'),
      writeRedirectConfigFile: jest.fn().mockResolvedValue({
        tempPath: '/tmp/redirect-test.conf',
        finalPath: '/etc/nginx/sites-enabled/redirect-test.conf',
      }),
    };

    mockNginxReloadService = {
      validateAndReload: jest.fn().mockResolvedValue({ success: true }),
      removeConfigAndReload: jest.fn().mockResolvedValue({ success: true }),
    };

    mockSslCertificateService = {
      ensureRedirectSslCert: jest.fn().mockResolvedValue({ success: true }),
      removeRedirectSslCert: jest.fn().mockResolvedValue(undefined),
      removeRedirectSslSymlink: jest.fn().mockResolvedValue(undefined), // deprecated
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedirectsService,
        { provide: NginxConfigService, useValue: mockNginxConfigService },
        { provide: NginxReloadService, useValue: mockNginxReloadService },
        { provide: SslCertificateService, useValue: mockSslCertificateService },
      ],
    }).compile();

    service = module.get<RedirectsService>(RedirectsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    const mockTargetDomain = {
      id: 'domain-uuid',
      domain: 'www.example.com',
      projectId: 'project-uuid',
    };

    const createDto = {
      sourceDomain: 'example.com',
      redirectType: '301' as const,
    };

    it('should throw NotFoundException if target domain not found', async () => {
      // Mock: target domain not found
      db.limit.mockResolvedValueOnce([]);

      await expect(service.create('non-existent-domain', createDto, 'user-uuid')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ConflictException if source domain already exists as redirect', async () => {
      // Mock: target domain exists
      db.limit.mockResolvedValueOnce([mockTargetDomain]);
      // Mock: source domain already exists as redirect
      db.limit.mockResolvedValueOnce([{ id: 'existing-redirect' }]);

      await expect(service.create('domain-uuid', createDto, 'user-uuid')).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw ConflictException if source equals target domain', async () => {
      // Mock: target domain exists
      db.limit.mockResolvedValueOnce([mockTargetDomain]);
      // Mock: no existing redirect
      db.limit.mockResolvedValueOnce([]);

      await expect(
        service.create(
          'domain-uuid',
          { ...createDto, sourceDomain: 'www.example.com' },
          'user-uuid',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException if source domain is an existing domain mapping', async () => {
      // Mock: target domain exists
      db.limit.mockResolvedValueOnce([mockTargetDomain]);
      // Mock: no existing redirect
      db.limit.mockResolvedValueOnce([]);
      // Mock: source domain exists as domain mapping
      db.limit.mockResolvedValueOnce([{ id: 'domain-mapping' }]);

      await expect(service.create('domain-uuid', createDto, 'user-uuid')).rejects.toThrow(
        ConflictException,
      );
    });

    it('should create redirect and generate nginx config on success', async () => {
      const mockRedirect = {
        id: 'redirect-uuid',
        sourceDomain: 'example.com',
        targetDomainId: 'domain-uuid',
        redirectType: '301',
        isActive: true,
        sslEnabled: false,
        nginxConfigPath: null,
        createdBy: 'user-uuid',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Mock: target domain exists
      db.limit.mockResolvedValueOnce([mockTargetDomain]);
      // Mock: no existing redirect
      db.limit.mockResolvedValueOnce([]);
      // Mock: no existing domain mapping with source domain
      db.limit.mockResolvedValueOnce([]);
      // Mock: insert returns new redirect
      db.returning.mockResolvedValueOnce([mockRedirect]);
      // Mock: update to set nginx path
      db.returning.mockResolvedValueOnce([]);

      const result = await service.create('domain-uuid', createDto, 'user-uuid');

      expect(result).toMatchObject({
        id: 'redirect-uuid',
        sourceDomain: 'example.com',
        targetDomain: 'www.example.com',
      });

      expect(mockNginxConfigService.generateRedirectConfig).toHaveBeenCalledWith({
        sourceDomain: 'example.com',
        targetDomain: 'www.example.com',
        redirectType: '301',
        sslEnabled: false,
        isActive: true,
      });

      expect(mockNginxReloadService.validateAndReload).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should throw NotFoundException if redirect not found', async () => {
      db.limit.mockResolvedValueOnce([]);

      await expect(service.findOne('non-existent', 'user-uuid')).rejects.toThrow(NotFoundException);
    });

    it('should return redirect with target domain', async () => {
      db.limit.mockResolvedValueOnce([
        {
          redirect: {
            id: 'redirect-uuid',
            sourceDomain: 'example.com',
            targetDomainId: 'domain-uuid',
            redirectType: '301',
            isActive: true,
            sslEnabled: false,
          },
          targetDomain: 'www.example.com',
        },
      ]);

      const result = await service.findOne('redirect-uuid', 'user-uuid');

      expect(result).toMatchObject({
        id: 'redirect-uuid',
        sourceDomain: 'example.com',
        targetDomain: 'www.example.com',
      });
    });
  });

  describe('remove', () => {
    it('should delete redirect and remove nginx config', async () => {
      const mockRedirect = {
        redirect: {
          id: 'redirect-uuid',
          sourceDomain: 'example.com',
          nginxConfigPath: '/etc/nginx/sites-enabled/redirect-test.conf',
        },
        targetDomain: 'www.example.com',
      };

      // Mock findOne
      db.limit.mockResolvedValueOnce([mockRedirect]);

      const result = await service.remove('redirect-uuid', 'user-uuid');

      expect(result).toEqual({ success: true });
      expect(mockNginxReloadService.removeConfigAndReload).toHaveBeenCalledWith(
        '/etc/nginx/sites-enabled/redirect-test.conf',
      );
    });
  });
});
