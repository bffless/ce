import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ProxyRulesService } from './proxy-rules.service';
import { PermissionsService } from '../permissions/permissions.service';
import { NginxRegenerationService } from '../domains/nginx-regeneration.service';
import { EmailService } from '../email/email.service';

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
    requireProjectAccess: jest.fn().mockResolvedValue(undefined),
    enforceApiKeyProjectScope: jest.fn(),
  };

  const mockNginxRegenerationService = {
    regenerateForRuleSet: jest.fn().mockResolvedValue(undefined),
    regenerateForAlias: jest.fn().mockResolvedValue(undefined),
  };

  const mockEmailService = {
    isConfigured: jest.fn().mockReturnValue(true),
    sendEmail: jest.fn().mockResolvedValue({ success: true }),
  };

  // Helper to create a mock rule (with new schema)
  const createMockRule = (overrides: Record<string, unknown> = {}) => ({
    id: 'rule-1',
    ruleSetId: 'rule-set-1',
    pathPattern: '/api/*',
    method: null,
    methods: null,
    targetUrl: 'https://api.example.com',
    stripPrefix: true,
    order: 0,
    timeout: 30000,
    preserveHost: false,
    forwardCookies: false,
    headerConfig: null,
    authTransform: null,
    internalRewrite: false,
    proxyType: 'external_proxy' as const,
    emailHandlerConfig: null,
    pipelineConfig: null,
    isEnabled: true,
    description: null,
    debugEnabled: false,
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
        { provide: EmailService, useValue: mockEmailService },
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

  // (Project access enforcement now lives in PermissionsService.requireProjectAccess
  // and is covered by permissions.service.spec.ts.)

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
        internalRewrite: false,
        proxyType: 'external_proxy' as const,
        emailHandlerConfig: null,
        pipelineConfig: null,
        isEnabled: true,
        description: null,
        debugEnabled: false,
        method: null,
        methods: null,
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

  describe('duplicate detection (methods[] aware)', () => {
    describe('create', () => {
      it('should throw ConflictException when methods[] match the same set in different order', async () => {
        // Existing rule: methods ['GET','POST'] on /api/*
        // New rule:      methods ['POST','GET'] on /api/*  → same signature → conflict
        const existingRule = createMockRule({ methods: ['GET', 'POST'] });

        mockDb.__setResults([
          [createMockRuleSet()], // rule set lookup (limit)
          [existingRule],        // findRuleByPattern (orderBy) — sig 'GET,POST' matches 'POST,GET' sorted
        ]);

        await expect(
          service.create(
            {
              ruleSetId: 'rule-set-1',
              pathPattern: '/api/*',
              targetUrl: 'https://api.example.com',
              methods: ['POST', 'GET'],
            },
            'user-id',
            'admin',
          ),
        ).rejects.toThrow(ConflictException);
      });

      it('should not conflict when existing methods and new methods are disjoint', async () => {
        // Existing rule: methods ['GET','POST'] → sig 'GET,POST'
        // New rule:      methods ['DELETE']      → sig 'DELETE'  → no overlap → no conflict
        const existingRule = createMockRule({ methods: ['GET', 'POST'] });

        mockDb.__setResults([
          [createMockRuleSet()], // rule set lookup (limit)
          [existingRule],        // findRuleByPattern (orderBy) — sig mismatch → returns null
          [],                    // getNextOrder (orderBy) — empty → order 0
          // insert returning uses mock fallback [{id:'test-id'}]
        ]);

        await expect(
          service.create(
            {
              ruleSetId: 'rule-set-1',
              pathPattern: '/api/*',
              targetUrl: 'https://api.example.com',
              methods: ['DELETE'],
            },
            'user-id',
            'admin',
          ),
        ).resolves.toBeDefined();
      });

      it('should not conflict when existing is any-method and new is method-specific', async () => {
        // Existing rule: method:null, methods:null → sig '' (matches any method)
        // New rule:      methods:['GET']           → sig 'GET'  → different sig → no conflict
        const existingAnyMethod = createMockRule({ method: null, methods: null });

        mockDb.__setResults([
          [createMockRuleSet()], // rule set lookup (limit)
          [existingAnyMethod],   // findRuleByPattern (orderBy) — sig '' vs 'GET' → no match → null
          [],                    // getNextOrder (orderBy)
        ]);

        await expect(
          service.create(
            {
              ruleSetId: 'rule-set-1',
              pathPattern: '/api/*',
              targetUrl: 'https://api.example.com',
              methods: ['GET'],
            },
            'user-id',
            'admin',
          ),
        ).resolves.toBeDefined();
      });
    });

    describe('update', () => {
      it('should throw ConflictException when new methods collide with a different existing rule', async () => {
        // rule-1 currently has methods:['GET']; we change it to methods:['DELETE']
        // rule-2 already owns methods:['DELETE'] on the same path → conflict
        const existingRule = createMockRule({ id: 'rule-1', pathPattern: '/api/*', methods: ['GET'] });
        const collidingRule = createMockRule({ id: 'rule-2', pathPattern: '/api/*', methods: ['DELETE'] });

        mockDb.__setResults([
          [existingRule],        // findById (limit)
          [createMockRuleSet()], // rule set lookup (limit)
          [collidingRule],       // findRuleByPattern (orderBy) — sig 'DELETE' matches → collision
        ]);

        await expect(
          service.update('rule-1', { methods: ['DELETE'] }, 'user-id', 'admin'),
        ).rejects.toThrow(ConflictException);
      });

      it('should not check for conflicts when only a non-signature field is updated', async () => {
        // Updating description only → pathPattern and methodSignature unchanged → no dup check
        const existingRule = createMockRule({ id: 'rule-1' });

        mockDb.__setResults([
          [existingRule],                                           // findById (limit)
          [createMockRuleSet()],                                    // rule set lookup (limit)
          [createMockRule({ id: 'rule-1', description: 'new' })],  // update.returning()
        ]);

        const findRuleByPatternSpy = jest.spyOn(service as any, 'findRuleByPattern');

        await expect(
          service.update('rule-1', { description: 'new' }, 'user-id', 'admin'),
        ).resolves.toBeDefined();

        expect(findRuleByPatternSpy).not.toHaveBeenCalled();
      });
    });
  });

  describe('updateStep', () => {
    const makePipelineRule = (overrides: Record<string, unknown> = {}) =>
      createMockRule({
        id: 'pipe-1',
        proxyType: 'pipeline' as const,
        targetUrl: 'pipeline',
        pipelineConfig: {
          name: 'my-pipeline',
          steps: [
            { id: 's1', name: 'parse', handlerType: 'form_handler', config: { a: 1 } },
            { id: 's2', name: 'send', handlerType: 'email_handler', config: { to: 'x@y.z' } },
          ],
          postSteps: [{ id: 'p1', name: 'log', handlerType: 'function_handler', config: { code: 'old' } }],
        },
        ...overrides,
      });

    it('throws NotFound when the rule does not exist', async () => {
      mockDb.__setResults([[]]); // findById -> none

      await expect(
        service.updateStep('missing', { stepName: 'parse' }, 'user-1', 'admin'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequest when the rule has no pipelineConfig', async () => {
      mockDb.__setResults([[createMockRule({ id: 'plain' })]]); // findById -> non-pipeline

      await expect(
        service.updateStep('plain', { stepName: 'parse' }, 'user-1', 'admin'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFound (with available step names) when the step is absent', async () => {
      mockDb.__setResults([[makePipelineRule()]]);

      await expect(
        service.updateStep('pipe-1', { stepName: 'nope' }, 'user-1', 'admin'),
      ).rejects.toThrow(/Available steps: parse, send/);
    });

    it('replaces the target step config by default and delegates to update()', async () => {
      mockDb.__setResults([[makePipelineRule()]]);
      const updateSpy = jest
        .spyOn(service, 'update')
        .mockResolvedValue(createMockRule() as never);

      await service.updateStep(
        'pipe-1',
        { stepName: 'parse', config: { b: 2 } },
        'user-1',
        'admin',
      );

      const passedConfig = updateSpy.mock.calls[0][1].pipelineConfig as any;
      expect(passedConfig.steps[0].config).toEqual({ b: 2 }); // replaced, not merged
      expect(passedConfig.steps[1]).toEqual({
        id: 's2',
        name: 'send',
        handlerType: 'email_handler',
        config: { to: 'x@y.z' },
      }); // untouched
    });

    it('shallow-merges config when mergeConfig is true', async () => {
      mockDb.__setResults([[makePipelineRule()]]);
      const updateSpy = jest
        .spyOn(service, 'update')
        .mockResolvedValue(createMockRule() as never);

      await service.updateStep(
        'pipe-1',
        { stepName: 'parse', config: { b: 2 }, mergeConfig: true },
        'user-1',
        'admin',
      );

      const passedConfig = updateSpy.mock.calls[0][1].pipelineConfig as any;
      expect(passedConfig.steps[0].config).toEqual({ a: 1, b: 2 });
    });

    it('patches a step in postSteps when target is postSteps', async () => {
      mockDb.__setResults([[makePipelineRule()]]);
      const updateSpy = jest
        .spyOn(service, 'update')
        .mockResolvedValue(createMockRule() as never);

      await service.updateStep(
        'pipe-1',
        { stepName: 'log', target: 'postSteps', config: { code: 'new' }, isEnabled: false },
        'user-1',
        'admin',
      );

      const passedConfig = updateSpy.mock.calls[0][1].pipelineConfig as any;
      expect(passedConfig.postSteps[0].config).toEqual({ code: 'new' });
      expect(passedConfig.postSteps[0].isEnabled).toBe(false);
      expect(passedConfig.steps).toHaveLength(2); // steps untouched
    });
  });
});
