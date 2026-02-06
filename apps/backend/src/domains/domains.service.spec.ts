import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ConflictException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { DomainsService } from './domains.service';
import { NginxConfigService } from './nginx-config.service';
import { NginxReloadService } from './nginx-reload.service';
import { ProjectsService } from '../projects/projects.service';
import { SslCertificateService } from './ssl-certificate.service';
import { SslInfoService } from './ssl-info.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { ProxyRulesService } from '../proxy-rules/proxy-rules.service';

// Mock the database client
jest.mock('../db/client', () => ({
  db: {
    select: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
}));

describe('DomainsService', () => {
  let service: DomainsService;
  let mockDb: any;
  let mockConfigService: jest.Mocked<ConfigService>;
  let mockNginxConfigService: jest.Mocked<NginxConfigService>;
  let mockNginxReloadService: jest.Mocked<NginxReloadService>;
  let mockProjectsService: jest.Mocked<ProjectsService>;
  let mockSslCertificateService: jest.Mocked<SslCertificateService>;
  let mockSslInfoService: jest.Mocked<SslInfoService>;
  let mockFeatureFlagsService: jest.Mocked<FeatureFlagsService>;
  let mockProxyRulesService: jest.Mocked<ProxyRulesService>;

  beforeEach(async () => {
    // Get the mocked db instance
    const { db } = require('../db/client');
    mockDb = db;

    // Reset all mocks before each test
    jest.clearAllMocks();

    // Create mock ConfigService (returns undefined for all env vars by default)
    mockConfigService = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as jest.Mocked<ConfigService>;

    // Create mocks for the new dependencies
    mockNginxConfigService = {
      generateConfig: jest.fn().mockResolvedValue('server { }'),
      writeConfigFile: jest.fn().mockResolvedValue({
        tempPath: '/tmp/domain-test.conf',
        finalPath: '/etc/nginx/sites-enabled/domain-test.conf',
      }),
      deleteConfigFile: jest.fn().mockResolvedValue(undefined),
      getConfigFilePath: jest.fn().mockReturnValue('/etc/nginx/sites-enabled/domain-test.conf'),
      onModuleInit: jest.fn(),
    } as unknown as jest.Mocked<NginxConfigService>;

    mockNginxReloadService = {
      validateAndReload: jest.fn().mockResolvedValue({ success: true }),
      removeConfigAndReload: jest.fn().mockResolvedValue({ success: true }),
    } as unknown as jest.Mocked<NginxReloadService>;

    mockProjectsService = {
      getProjectById: jest.fn().mockResolvedValue({
        id: 'proj-1',
        owner: 'testowner',
        name: 'testrepo',
      }),
    } as unknown as jest.Mocked<ProjectsService>;

    mockSslCertificateService = {
      initialize: jest.fn().mockResolvedValue(undefined),
      startWildcardCertificateRequest: jest.fn().mockResolvedValue({
        domain: 'localhost',
        recordName: '_acme-challenge.localhost',
        recordValue: 'test-token',
        token: 'test-token',
        expiresAt: new Date(),
      }),
      completeWildcardCertificateRequest: jest.fn().mockResolvedValue({
        success: true,
        expiresAt: new Date(),
      }),
      requestCustomDomainCertificate: jest.fn().mockResolvedValue({
        success: true,
        expiresAt: new Date(),
      }),
      checkWildcardCertificate: jest.fn().mockResolvedValue({
        exists: false,
      }),
      checkCustomDomainCertificate: jest.fn().mockResolvedValue({
        exists: false,
      }),
      getPendingChallenge: jest.fn().mockReturnValue(null),
      isInitialized: jest.fn().mockReturnValue(true),
    } as unknown as jest.Mocked<SslCertificateService>;

    mockSslInfoService = {
      getDomainSslInfo: jest.fn().mockResolvedValue(null),
      getWildcardCertInfo: jest.fn().mockResolvedValue(null),
      getAppDomainCertInfo: jest.fn().mockResolvedValue(null),
      certificateExists: jest.fn().mockResolvedValue(false),
      parseCertificate: jest.fn(),
    } as unknown as jest.Mocked<SslInfoService>;

    mockFeatureFlagsService = {
      isEnabled: jest.fn().mockResolvedValue(true),
      getValue: jest.fn(),
      getAllFlags: jest.fn(),
      getClientFlags: jest.fn(),
    } as unknown as jest.Mocked<FeatureFlagsService>;

    mockProxyRulesService = {
      getRulesByRuleSetId: jest.fn().mockResolvedValue([]),
      getEffectiveRulesForRuleSet: jest.fn().mockResolvedValue([]),
      getRuleById: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<ProxyRulesService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DomainsService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: NginxConfigService, useValue: mockNginxConfigService },
        { provide: NginxReloadService, useValue: mockNginxReloadService },
        { provide: ProjectsService, useValue: mockProjectsService },
        { provide: SslCertificateService, useValue: mockSslCertificateService },
        { provide: SslInfoService, useValue: mockSslInfoService },
        { provide: FeatureFlagsService, useValue: mockFeatureFlagsService },
        { provide: ProxyRulesService, useValue: mockProxyRulesService },
      ],
    }).compile();

    service = module.get<DomainsService>(DomainsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should reject custom domain when feature flag is disabled', async () => {
      // Mock feature flag to return false for custom domains
      mockFeatureFlagsService.isEnabled.mockResolvedValue(false);

      const dto = {
        projectId: 'proj-1',
        domain: 'custom.example.com',
        domainType: 'custom' as const,
      };

      await expect(service.create(dto, 'user-1')).rejects.toThrow(ForbiddenException);
      await expect(service.create(dto, 'user-1')).rejects.toThrow(
        'Custom domains are not available',
      );
    });

    it('should allow subdomain even when custom domains feature flag is disabled', async () => {
      // Mock feature flag to return false for custom domains
      mockFeatureFlagsService.isEnabled.mockResolvedValue(false);

      // Mock db.select to return no existing domains
      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      const createdDomain = {
        id: 'new-id',
        projectId: 'proj-1',
        domain: 'mysubdomain.localhost',
        domainType: 'subdomain',
        dnsVerified: true,
        sslEnabled: false,
        isActive: true,
        alias: null,
        path: null,
        createdAt: new Date(),
      };

      mockDb.insert.mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([createdDomain]),
        }),
      });

      mockDb.update.mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([createdDomain]),
          }),
        }),
      });

      const dto = {
        projectId: 'proj-1',
        domain: 'mysubdomain.localhost',
        domainType: 'subdomain' as const,
      };

      // Should not throw - subdomains are allowed even when custom domains are disabled
      const result = await service.create(dto, 'user-1');
      expect(result.domain).toBe('mysubdomain.localhost');
    });

    it('should reject reserved subdomain', async () => {
      const dto = {
        projectId: 'proj-1',
        domain: 'admin.localhost',
        domainType: 'subdomain' as const,
      };

      await expect(service.create(dto, 'user-1')).rejects.toThrow(ConflictException);
      await expect(service.create(dto, 'user-1')).rejects.toThrow('Subdomain "admin" is reserved');
    });

    it('should reject duplicate domain', async () => {
      // Mock db.select to return an existing domain
      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ id: 'existing' }]),
          }),
        }),
      });

      const dto = {
        projectId: 'proj-1',
        domain: 'coverage.localhost',
        domainType: 'subdomain' as const,
      };

      await expect(service.create(dto, 'user-1')).rejects.toThrow(ConflictException);
      await expect(service.create(dto, 'user-1')).rejects.toThrow(
        'Domain "coverage.localhost" already exists',
      );
    });

    it('should create valid subdomain and generate nginx config', async () => {
      // Mock db.select to return no existing domains
      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      const createdDomain = {
        id: 'new-id',
        projectId: 'proj-1',
        domain: 'coverage.localhost',
        domainType: 'subdomain',
        dnsVerified: true,
        sslEnabled: false,
        isActive: true,
        alias: null,
        path: null,
        createdAt: new Date(),
      };

      // Mock db.insert to return the created domain
      mockDb.insert.mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([createdDomain]),
        }),
      });

      // Mock db.update to return the updated domain with nginx path
      mockDb.update.mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([
              {
                ...createdDomain,
                nginxConfigPath: '/etc/nginx/sites-enabled/domain-new-id.conf',
              },
            ]),
          }),
        }),
      });

      const dto = {
        projectId: 'proj-1',
        domain: 'coverage.localhost',
        domainType: 'subdomain' as const,
      };

      const result = await service.create(dto, 'user-1');

      expect(result.domain).toBe('coverage.localhost');
      expect(result.dnsVerified).toBe(true);
      expect(mockProjectsService.getProjectById).toHaveBeenCalledWith('proj-1');
      expect(mockNginxConfigService.generateConfig).toHaveBeenCalled();
      expect(mockNginxConfigService.writeConfigFile).toHaveBeenCalled();
      expect(mockNginxReloadService.validateAndReload).toHaveBeenCalled();
    });

    it('should rollback on nginx reload failure', async () => {
      // Mock db.select to return no existing domains
      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      const createdDomain = {
        id: 'new-id',
        projectId: 'proj-1',
        domain: 'coverage.localhost',
        domainType: 'subdomain',
        dnsVerified: true,
        createdAt: new Date(),
      };

      // Mock db.insert to return the created domain
      mockDb.insert.mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([createdDomain]),
        }),
      });

      // Mock nginx reload to fail
      mockNginxReloadService.validateAndReload.mockResolvedValue({
        success: false,
        error: 'Invalid nginx configuration',
      });

      // Mock db.delete for rollback
      mockDb.delete.mockReturnValue({
        where: jest.fn().mockResolvedValue(undefined),
      });

      const dto = {
        projectId: 'proj-1',
        domain: 'coverage.localhost',
        domainType: 'subdomain' as const,
      };

      await expect(service.create(dto, 'user-1')).rejects.toThrow(ConflictException);
      await expect(service.create(dto, 'user-1')).rejects.toThrow(
        'Failed to reload nginx: Invalid nginx configuration',
      );

      // Verify rollback was called
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('should auto-verify subdomains but not custom domains', async () => {
      // Mock db.select to return no existing domains
      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      let capturedValues: any;
      mockDb.insert.mockReturnValue({
        values: jest.fn().mockImplementation((values) => {
          capturedValues = values;
          return {
            returning: jest.fn().mockResolvedValue([
              {
                id: 'new-id',
                ...values,
                createdAt: new Date(),
              },
            ]),
          };
        }),
      });

      // Mock db.update for nginx path update
      mockDb.update.mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest
              .fn()
              .mockImplementation(() => Promise.resolve([{ id: 'new-id', ...capturedValues }])),
          }),
        }),
      });

      // Test subdomain
      const subdomainDto = {
        projectId: 'proj-1',
        domain: 'myapp.localhost',
        domainType: 'subdomain' as const,
      };
      await service.create(subdomainDto, 'user-1');
      expect(capturedValues.dnsVerified).toBe(true);

      // Reset mocks
      jest.clearAllMocks();
      // Re-enable feature flag after clearing mocks
      mockFeatureFlagsService.isEnabled.mockResolvedValue(true);
      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });
      mockDb.insert.mockReturnValue({
        values: jest.fn().mockImplementation((values) => {
          capturedValues = values;
          return {
            returning: jest.fn().mockResolvedValue([
              {
                id: 'new-id',
                ...values,
                createdAt: new Date(),
              },
            ]),
          };
        }),
      });
      mockDb.update.mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest
              .fn()
              .mockImplementation(() => Promise.resolve([{ id: 'new-id', ...capturedValues }])),
          }),
        }),
      });

      // Test custom domain
      const customDto = {
        projectId: 'proj-1',
        domain: 'custom.example.com',
        domainType: 'custom' as const,
      };
      await service.create(customDto, 'user-1');
      expect(capturedValues.dnsVerified).toBe(false);
    });
  });

  describe('validatePath', () => {
    it('should reject path without leading slash', () => {
      expect(() => service['validatePath']('apps/frontend')).toThrow(ConflictException);
      expect(() => service['validatePath']('apps/frontend')).toThrow('Path must start with /');
    });

    it('should reject path with ..', () => {
      expect(() => service['validatePath']('/apps/../etc/passwd')).toThrow(ConflictException);
      expect(() => service['validatePath']('/apps/../etc/passwd')).toThrow(
        'Path cannot contain ..',
      );
    });

    it('should reject path with //', () => {
      expect(() => service['validatePath']('/apps//frontend')).toThrow(ConflictException);
      expect(() => service['validatePath']('/apps//frontend')).toThrow('Path cannot contain //');
    });

    it('should accept valid path', () => {
      expect(() => service['validatePath']('/apps/frontend/coverage')).not.toThrow();
    });

    it('should accept root path', () => {
      expect(() => service['validatePath']('/')).not.toThrow();
    });
  });

  describe('findOne', () => {
    it('should throw NotFoundException when domain not found', async () => {
      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(service.findOne('non-existent-id', 'user-1')).rejects.toThrow(NotFoundException);
      await expect(service.findOne('non-existent-id', 'user-1')).rejects.toThrow(
        'Domain mapping with ID non-existent-id not found',
      );
    });

    it('should return domain when found', async () => {
      const mockDomain = {
        id: 'domain-1',
        projectId: 'proj-1',
        domain: 'coverage.localhost',
        domainType: 'subdomain',
        isActive: true,
      };

      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockDomain]),
          }),
        }),
      });

      const result = await service.findOne('domain-1', 'user-1');
      expect(result).toEqual(mockDomain);
    });
  });

  describe('update', () => {
    it('should throw NotFoundException when domain not found', async () => {
      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(
        service.update('non-existent-id', { isActive: false }, 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should update domain when found', async () => {
      const mockDomain = {
        id: 'domain-1',
        projectId: 'proj-1',
        domain: 'coverage.localhost',
        domainType: 'subdomain',
        isActive: true,
        sslEnabled: false,
        createdAt: new Date(),
      };

      // Mock findOne
      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockDomain]),
          }),
        }),
      });

      // Mock update
      mockDb.update.mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([{ ...mockDomain, isActive: false }]),
          }),
        }),
      });

      const result = await service.update('domain-1', { isActive: false }, 'user-1');
      expect(result.isActive).toBe(false);
    });

    it('should validate path when updating', async () => {
      const mockDomain = {
        id: 'domain-1',
        projectId: 'proj-1',
        domain: 'coverage.localhost',
        domainType: 'subdomain',
        isActive: true,
      };

      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockDomain]),
          }),
        }),
      });

      await expect(service.update('domain-1', { path: 'invalid/path' }, 'user-1')).rejects.toThrow(
        ConflictException,
      );
      await expect(service.update('domain-1', { path: 'invalid/path' }, 'user-1')).rejects.toThrow(
        'Path must start with /',
      );
    });
  });

  describe('remove', () => {
    it('should throw NotFoundException when domain not found', async () => {
      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(service.remove('non-existent-id', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('should delete domain and remove nginx config', async () => {
      const mockDomain = {
        id: 'domain-1',
        projectId: 'proj-1',
        domain: 'coverage.localhost',
        domainType: 'subdomain',
        isActive: true,
        nginxConfigPath: '/etc/nginx/sites-enabled/domain-1.conf',
      };

      // Mock findOne
      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockDomain]),
          }),
        }),
      });

      // Mock delete
      mockDb.delete.mockReturnValue({
        where: jest.fn().mockResolvedValue(undefined),
      });

      const result = await service.remove('domain-1', 'user-1');
      expect(result.success).toBe(true);
      expect(result.nginxConfigPath).toBe('/etc/nginx/sites-enabled/domain-1.conf');
      expect(mockNginxReloadService.removeConfigAndReload).toHaveBeenCalledWith(
        '/etc/nginx/sites-enabled/domain-1.conf',
      );
    });

    it('should still succeed if nginx config removal fails', async () => {
      const mockDomain = {
        id: 'domain-1',
        projectId: 'proj-1',
        domain: 'coverage.localhost',
        domainType: 'subdomain',
        isActive: true,
        nginxConfigPath: '/etc/nginx/sites-enabled/domain-1.conf',
      };

      // Mock findOne
      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockDomain]),
          }),
        }),
      });

      // Mock delete
      mockDb.delete.mockReturnValue({
        where: jest.fn().mockResolvedValue(undefined),
      });

      // Mock nginx removal to fail
      mockNginxReloadService.removeConfigAndReload.mockRejectedValue(new Error('File not found'));

      // Should still succeed (domain is already deleted)
      const result = await service.remove('domain-1', 'user-1');
      expect(result.success).toBe(true);
    });
  });
});
