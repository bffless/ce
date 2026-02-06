import { Test, TestingModule } from '@nestjs/testing';
import { VisibilityService } from './visibility.service';
import { db } from '../db/client';
import { DomainMapping } from '../db/schema';

// Mock the database client
jest.mock('../db/client', () => ({
  db: {
    select: jest.fn(),
  },
}));

describe('VisibilityService', () => {
  let service: VisibilityService;
  let mockSelect: jest.Mock;

  beforeEach(async () => {
    mockSelect = db.select as jest.Mock;

    const module: TestingModule = await Test.createTestingModule({
      providers: [VisibilityService],
    }).compile();

    service = module.get<VisibilityService>(VisibilityService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('resolveVisibility', () => {
    const baseDomainMapping: DomainMapping = {
      id: 'domain-1',
      projectId: 'project-1',
      domain: 'test.example.com',
      domainType: 'subdomain',
      alias: 'production',
      path: null,
      isActive: true,
      isPublic: null,
      unauthorizedBehavior: null,
      requiredRole: null,
      sslEnabled: false,
      sslExpiresAt: null,
      dnsVerified: true,
      dnsVerifiedAt: null,
      nginxConfigPath: null,
      createdBy: 'user-1',
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
      // Phase B: SSL auto-renewal fields
      autoRenewSsl: true,
      sslRenewedAt: null,
      sslRenewalStatus: null,
      sslRenewalError: null,
      // Phase C: Traffic routing
      stickySessionsEnabled: true,
      stickySessionDuration: 86400,
      // SPA mode
      isSpa: false,
      // Primary domain
      isPrimary: false,
      wwwBehavior: null,
      // Redirect domain
      redirectTarget: null,
    };

    it('should return domain override when isPublic is true', async () => {
      const domainMapping: DomainMapping = {
        ...baseDomainMapping,
        isPublic: true,
      };

      const result = await service.resolveVisibility(domainMapping);

      expect(result).toBe(true);
      // Should not query database for alias or project
      expect(mockSelect).not.toHaveBeenCalled();
    });

    it('should return domain override when isPublic is false', async () => {
      const domainMapping: DomainMapping = {
        ...baseDomainMapping,
        isPublic: false,
      };

      const result = await service.resolveVisibility(domainMapping);

      expect(result).toBe(false);
      expect(mockSelect).not.toHaveBeenCalled();
    });

    it('should check alias visibility when domain isPublic is null', async () => {
      const domainMapping: DomainMapping = {
        ...baseDomainMapping,
        isPublic: null,
        alias: 'production',
      };

      // Mock alias query returning isPublic = true
      const mockFrom = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([{ isPublic: true }]),
        }),
      });
      mockSelect.mockReturnValue({ from: mockFrom });

      const result = await service.resolveVisibility(domainMapping);

      expect(result).toBe(true);
    });

    it('should fall back to project visibility when alias has no override', async () => {
      const domainMapping: DomainMapping = {
        ...baseDomainMapping,
        isPublic: null,
        alias: 'production',
      };

      // First call for alias returns null isPublic
      // Second call for project returns isPublic = false
      let callCount = 0;
      const mockFrom = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
              return Promise.resolve([{ isPublic: null }]); // alias
            }
            return Promise.resolve([{ isPublic: false }]); // project
          }),
        }),
      });
      mockSelect.mockReturnValue({ from: mockFrom });

      const result = await service.resolveVisibility(domainMapping);

      expect(result).toBe(false);
    });

    it('should skip alias check when domain has no alias', async () => {
      const domainMapping: DomainMapping = {
        ...baseDomainMapping,
        isPublic: null,
        alias: null, // No alias
      };

      // Mock project query returning isPublic = true
      const mockFrom = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([{ isPublic: true }]),
        }),
      });
      mockSelect.mockReturnValue({ from: mockFrom });

      const result = await service.resolveVisibility(domainMapping);

      expect(result).toBe(true);
      // Should only query project, not alias
      expect(mockSelect).toHaveBeenCalledTimes(1);
    });
  });

  describe('resolveAliasVisibility', () => {
    it('should return alias override when set', async () => {
      // Mock alias query returning isPublic = true
      const mockFrom = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([{ isPublic: true }]),
        }),
      });
      mockSelect.mockReturnValue({ from: mockFrom });

      const result = await service.resolveAliasVisibility('project-1', 'production');

      expect(result).toBe(true);
    });

    it('should fall back to project when alias has no override', async () => {
      let callCount = 0;
      const mockFrom = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
              return Promise.resolve([{ isPublic: null }]); // alias
            }
            return Promise.resolve([{ isPublic: true }]); // project
          }),
        }),
      });
      mockSelect.mockReturnValue({ from: mockFrom });

      const result = await service.resolveAliasVisibility('project-1', 'production');

      expect(result).toBe(true);
    });

    it('should return project visibility when alias does not exist', async () => {
      let callCount = 0;
      const mockFrom = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
              return Promise.resolve([]); // alias not found
            }
            return Promise.resolve([{ isPublic: false }]); // project
          }),
        }),
      });
      mockSelect.mockReturnValue({ from: mockFrom });

      const result = await service.resolveAliasVisibility('project-1', 'nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('getVisibilityInfo', () => {
    const baseDomainMapping: DomainMapping = {
      id: 'domain-1',
      projectId: 'project-1',
      domain: 'test.example.com',
      domainType: 'subdomain',
      alias: 'production',
      path: null,
      isActive: true,
      isPublic: null,
      unauthorizedBehavior: null,
      requiredRole: null,
      sslEnabled: false,
      sslExpiresAt: null,
      dnsVerified: true,
      dnsVerifiedAt: null,
      nginxConfigPath: null,
      createdBy: 'user-1',
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
      // Phase B: SSL auto-renewal fields
      autoRenewSsl: true,
      sslRenewedAt: null,
      sslRenewalStatus: null,
      sslRenewalError: null,
      // Phase C: Traffic routing
      stickySessionsEnabled: true,
      stickySessionDuration: 86400,
      // SPA mode
      isSpa: false,
      // Primary domain
      isPrimary: false,
      wwwBehavior: null,
      // Redirect domain
      redirectTarget: null,
    };

    it('should return domain as source when domain has override', async () => {
      const domainMapping: DomainMapping = {
        ...baseDomainMapping,
        isPublic: true,
      };

      // Mock both alias and project queries
      let callCount = 0;
      const mockFrom = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
              return Promise.resolve([{ isPublic: null }]); // alias has no override
            }
            return Promise.resolve([{ isPublic: false }]); // project
          }),
        }),
      });
      mockSelect.mockReturnValue({ from: mockFrom });

      const result = await service.getVisibilityInfo(domainMapping);

      expect(result).toEqual({
        effectiveVisibility: true,
        source: 'domain',
        domainOverride: true,
        aliasVisibility: null, // alias has no override
        projectVisibility: false,
      });
    });

    it('should return alias as source when domain inherits and alias has override', async () => {
      const domainMapping: DomainMapping = {
        ...baseDomainMapping,
        isPublic: null,
        alias: 'production',
      };

      let callCount = 0;
      const mockFrom = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
              return Promise.resolve([{ isPublic: true }]); // alias
            }
            return Promise.resolve([{ isPublic: false }]); // project
          }),
        }),
      });
      mockSelect.mockReturnValue({ from: mockFrom });

      const result = await service.getVisibilityInfo(domainMapping);

      expect(result).toEqual({
        effectiveVisibility: true,
        source: 'alias',
        domainOverride: null,
        aliasVisibility: true,
        projectVisibility: false,
      });
    });

    it('should return project as source when both domain and alias inherit', async () => {
      const domainMapping: DomainMapping = {
        ...baseDomainMapping,
        isPublic: null,
        alias: 'production',
      };

      let callCount = 0;
      const mockFrom = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
              return Promise.resolve([{ isPublic: null }]); // alias inherits
            }
            return Promise.resolve([{ isPublic: true }]); // project
          }),
        }),
      });
      mockSelect.mockReturnValue({ from: mockFrom });

      const result = await service.getVisibilityInfo(domainMapping);

      expect(result).toEqual({
        effectiveVisibility: true,
        source: 'project',
        domainOverride: null,
        aliasVisibility: null,
        projectVisibility: true,
      });
    });
  });

  describe('resolveVisibilityByDomain', () => {
    it('should return null when domain not found', async () => {
      const mockFrom = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([]),
        }),
      });
      mockSelect.mockReturnValue({ from: mockFrom });

      const result = await service.resolveVisibilityByDomain('nonexistent.example.com');

      expect(result).toBeNull();
    });

    it('should resolve visibility for found domain', async () => {
      const foundDomain = {
        id: 'domain-1',
        projectId: 'project-1',
        domain: 'test.example.com',
        domainType: 'subdomain',
        alias: null,
        path: null,
        isActive: true,
        isPublic: true, // Domain override
        sslEnabled: false,
        sslExpiresAt: null,
        dnsVerified: true,
        dnsVerifiedAt: null,
        nginxConfigPath: null,
        createdBy: 'user-1',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      };

      const mockFrom = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([foundDomain]),
        }),
      });
      mockSelect.mockReturnValue({ from: mockFrom });

      const result = await service.resolveVisibilityByDomain('test.example.com');

      expect(result).toBe(true);
    });
  });
});
