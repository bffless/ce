import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ProxyRulesService } from './proxy-rules.service';
import { PermissionsService } from '../permissions/permissions.service';
import { NginxRegenerationService } from '../domains/nginx-regeneration.service';

// Mock the db client - using factory function for hoisting
jest.mock('../db/client', () => {
  // Create mocks inside the factory
  const mockResults: { data: unknown[] }[] = [];
  let callIdx = 0;

  const chainable = {
    select: jest.fn(() => chainable),
    from: jest.fn(() => chainable),
    where: jest.fn(() => chainable),
    orderBy: jest.fn(() => {
      const result = mockResults[callIdx]?.data || [];
      callIdx++;
      return Promise.resolve(result);
    }),
    limit: jest.fn(() => {
      const result = mockResults[callIdx]?.data || [];
      callIdx++;
      return Promise.resolve(result);
    }),
    insert: jest.fn(() => chainable),
    values: jest.fn(() => chainable),
    returning: jest.fn(() => {
      const result = mockResults[callIdx]?.data || [{ id: 'test-id' }];
      callIdx++;
      return Promise.resolve(result);
    }),
    update: jest.fn(() => chainable),
    set: jest.fn(() => chainable),
    delete: jest.fn(() => chainable),
    // Helper to set results and reset index
    __setResults: (results: unknown[][]) => {
      mockResults.length = 0;
      results.forEach((r) => mockResults.push({ data: r }));
      callIdx = 0;
    },
    __reset: () => {
      mockResults.length = 0;
      callIdx = 0;
    },
  };

  return { db: chainable };
});

// Get reference to the mocked db
import { db } from '../db/client';
const mockDb = db as unknown as {
  __setResults: (results: unknown[][]) => void;
  __reset: () => void;
};

describe('ProxyRulesService', () => {
  let service: ProxyRulesService;

  // Generate a proper 32-byte key for AES-256
  const validEncryptionKey = Buffer.alloc(32, 'a').toString('base64');
  const mockConfigService = {
    get: jest.fn().mockReturnValue(validEncryptionKey),
  };

  const mockPermissionsService = {
    getUserProjectRole: jest.fn(),
  };

  const mockNginxRegenerationService = {
    regenerateForRuleSet: jest.fn().mockResolvedValue(undefined),
    regenerateForAlias: jest.fn().mockResolvedValue(undefined),
  };

  // Helper to create a mock rule (with new schema)
  const createMockRule = (overrides: Record<string, unknown> = {}) => ({
    id: 'rule-1',
    ruleSetId: 'rule-set-1',
    pathPattern: '/api/*',
    targetUrl: 'https://api.example.com',
    stripPrefix: true,
    order: 0,
    timeout: 30000,
    preserveHost: false,
    forwardCookies: false,
    headerConfig: null,
    authTransform: null,
    isEnabled: true,
    description: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  // Helper to create a mock rule set
  const createMockRuleSet = (overrides: Record<string, unknown> = {}) => ({
    id: 'rule-set-1',
    projectId: 'project-1',
    name: 'api-backend',
    description: 'API proxy rules',
    environment: 'production',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(async () => {
    mockDb.__reset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProxyRulesService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PermissionsService, useValue: mockPermissionsService },
        { provide: NginxRegenerationService, useValue: mockNginxRegenerationService },
      ],
    }).compile();

    service = module.get<ProxyRulesService>(ProxyRulesService);
    jest.clearAllMocks();
  });

  describe('validateTargetUrl', () => {
    it('should reject non-HTTPS URLs', async () => {
      // First result: rule set lookup
      mockDb.__setResults([[createMockRuleSet()]]);

      await expect(
        service.create(
          {
            ruleSetId: 'rule-set-1',
            pathPattern: '/api/*',
            targetUrl: 'http://api.example.com',
          },
          'user-id',
          'admin',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow localhost for same-pod sidecar communication', async () => {
      // Localhost is allowed for same-pod sidecar communication (nginx -> backend)
      // The test verifies URL validation passes by checking the error is NOT about URL validation
      mockDb.__setResults([[createMockRuleSet()]]);

      try {
        await service.create(
          {
            ruleSetId: 'rule-set-1',
            pathPattern: '/api/*',
            targetUrl: 'http://localhost:3000',
          },
          'user-id',
          'admin',
        );
      } catch (error) {
        // If we get an error, it should NOT be about URL validation
        // (it will be a mock-related error since we didn't mock all DB calls)
        expect((error as Error).message).not.toContain('Target URL must use HTTPS');
        expect((error as Error).message).not.toContain('internal services');
        expect((error as Error).message).not.toContain('internal IP ranges');
      }
    });

    it('should allow 127.0.0.1 for same-pod sidecar communication', async () => {
      // 127.0.0.1 is allowed for same-pod sidecar communication
      mockDb.__setResults([[createMockRuleSet()]]);

      try {
        await service.create(
          {
            ruleSetId: 'rule-set-1',
            pathPattern: '/api/*',
            targetUrl: 'http://127.0.0.1:3000',
          },
          'user-id',
          'admin',
        );
      } catch (error) {
        // If we get an error, it should NOT be about URL validation
        expect((error as Error).message).not.toContain('Target URL must use HTTPS');
        expect((error as Error).message).not.toContain('internal services');
        expect((error as Error).message).not.toContain('internal IP ranges');
      }
    });

    it('should reject internal 192.168.x.x IPs', async () => {
      mockDb.__setResults([[createMockRuleSet()]]);

      await expect(
        service.create(
          {
            ruleSetId: 'rule-set-1',
            pathPattern: '/api/*',
            targetUrl: 'https://192.168.1.1',
          },
          'user-id',
          'admin',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject internal 10.x.x.x IPs', async () => {
      mockDb.__setResults([[createMockRuleSet()]]);

      await expect(
        service.create(
          {
            ruleSetId: 'rule-set-1',
            pathPattern: '/api/*',
            targetUrl: 'https://10.0.0.1',
          },
          'user-id',
          'admin',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject AWS/GCP metadata endpoint', async () => {
      mockDb.__setResults([[createMockRuleSet()]]);

      await expect(
        service.create(
          {
            ruleSetId: 'rule-set-1',
            pathPattern: '/api/*',
            targetUrl: 'https://169.254.169.254',
          },
          'user-id',
          'admin',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject invalid URL format', async () => {
      mockDb.__setResults([[createMockRuleSet()]]);

      await expect(
        service.create(
          {
            ruleSetId: 'rule-set-1',
            pathPattern: '/api/*',
            targetUrl: 'not-a-valid-url',
          },
          'user-id',
          'admin',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('create', () => {
    it('should throw NotFoundException if rule set not found', async () => {
      mockDb.__setResults([[]]); // Empty result for rule set lookup

      await expect(
        service.create(
          {
            ruleSetId: 'non-existent',
            pathPattern: '/api/*',
            targetUrl: 'https://api.example.com',
          },
          'user-id',
          'admin',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('checkProjectAccess', () => {
    it('should allow admin users access to any project', async () => {
      const result = await service['checkProjectAccess'](
        'any-project',
        'any-user',
        'admin',
        'admin',
      );
      expect(result).toBeUndefined();
    });

    it('should deny access for users without project role', async () => {
      mockPermissionsService.getUserProjectRole.mockResolvedValue(null);

      await expect(
        service['checkProjectAccess']('project-id', 'user-id', 'user', 'contributor'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should deny access for users with insufficient role', async () => {
      mockPermissionsService.getUserProjectRole.mockResolvedValue('viewer');

      await expect(
        service['checkProjectAccess']('project-id', 'user-id', 'user', 'contributor'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow access for users with sufficient role', async () => {
      mockPermissionsService.getUserProjectRole.mockResolvedValue('contributor');

      const result = await service['checkProjectAccess'](
        'project-id',
        'user-id',
        'user',
        'contributor',
      );
      expect(result).toBeUndefined();
    });
  });

  describe('encryption', () => {
    it('should encrypt and decrypt header values correctly', () => {
      const config = {
        add: { 'X-API-Key': 'secret123', Authorization: 'Bearer token' },
      };

      const encrypted = service['encryptHeaderConfig'](config);

      expect(encrypted.add!['X-API-Key']).not.toBe('secret123');
      expect(encrypted.add!['Authorization']).not.toBe('Bearer token');

      const mockRule = {
        id: 'test',
        ruleSetId: 'rule-set-1',
        pathPattern: '/api/*',
        targetUrl: 'https://api.example.com',
        stripPrefix: true,
        order: 0,
        timeout: 30000,
        preserveHost: false,
        forwardCookies: false,
        headerConfig: encrypted,
        authTransform: null,
        isEnabled: true,
        description: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const decrypted = service['decryptHeaderConfig'](mockRule);

      expect(decrypted.headerConfig!.add!['X-API-Key']).toBe('secret123');
      expect(decrypted.headerConfig!.add!['Authorization']).toBe('Bearer token');
    });

    it('should handle config without add field', () => {
      const config = { forward: ['accept'] };

      const encrypted = service['encryptHeaderConfig'](config);
      expect(encrypted).toEqual(config);
    });

    it('should handle decryption failure gracefully', () => {
      const mockRule = createMockRule({
        headerConfig: {
          add: { 'X-API-Key': 'not-encrypted-value' },
        },
      });

      const decrypted = service['decryptHeaderConfig'](mockRule);
      expect(decrypted.headerConfig!.add!['X-API-Key']).toBe('not-encrypted-value');
    });

    it('should handle rule without header config', () => {
      const mockRule = createMockRule({ headerConfig: null });
      const decrypted = service['decryptHeaderConfig'](mockRule);
      expect(decrypted.headerConfig).toBeNull();
    });
  });

  describe('getRulesByRuleSetId', () => {
    it('should return rules for a rule set ordered by order', async () => {
      const mockRules = [
        createMockRule({ id: 'rule-1', order: 0 }),
        createMockRule({ id: 'rule-2', order: 1, pathPattern: '/graphql' }),
      ];

      mockDb.__setResults([mockRules]);

      const rules = await service.getRulesByRuleSetId('rule-set-1');

      expect(rules).toHaveLength(2);
    });

    it('should return empty array for rule set without rules', async () => {
      mockDb.__setResults([[]]);

      const rules = await service.getRulesByRuleSetId('rule-set-1');

      expect(rules).toHaveLength(0);
    });
  });

  describe('getEffectiveRulesForRuleSet', () => {
    it('should return empty array when ruleSetId is null', async () => {
      const rules = await service.getEffectiveRulesForRuleSet(null);
      expect(rules).toHaveLength(0);
    });

    it('should return enabled rules for a rule set', async () => {
      const mockRules = [
        createMockRule({ id: 'rule-1', isEnabled: true }),
        createMockRule({ id: 'rule-2', isEnabled: false }),
        createMockRule({ id: 'rule-3', isEnabled: true }),
      ];

      mockDb.__setResults([mockRules]);

      const rules = await service.getEffectiveRulesForRuleSet('rule-set-1');

      expect(rules).toHaveLength(2);
      expect(rules.every((r) => r.isEnabled)).toBe(true);
    });
  });

  describe('getRuleById', () => {
    it('should return rule when found', async () => {
      const mockRule = createMockRule();
      mockDb.__setResults([[mockRule]]);

      const rule = await service.getRuleById('rule-1');

      expect(rule).not.toBeNull();
      expect(rule!.id).toBe('rule-1');
    });

    it('should return null when rule not found', async () => {
      mockDb.__setResults([[]]);

      const rule = await service.getRuleById('non-existent');

      expect(rule).toBeNull();
    });
  });
});
