import { Test, TestingModule } from '@nestjs/testing';
import { NginxConfigService } from './nginx-config.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import * as fs from 'fs/promises';
import * as path from 'path';

// Mock fs/promises
jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
  writeFile: jest.fn(),
  unlink: jest.fn(),
  access: jest.fn(),
}));

// Mock FeatureFlagsService
const mockFeatureFlagsService = {
  isEnabled: jest.fn().mockResolvedValue(true),
  get: jest.fn(),
};

describe('NginxConfigService', () => {
  let service: NginxConfigService;
  let mockReadFile: jest.MockedFunction<typeof fs.readFile>;
  let mockWriteFile: jest.MockedFunction<typeof fs.writeFile>;
  let mockUnlink: jest.MockedFunction<typeof fs.unlink>;
  let mockAccess: jest.MockedFunction<typeof fs.access>;

  const subdomainTemplate = `
# Generated config for domain mapping: {{domain}}
server {
    listen 80;
    server_name {{domain}};
    location / {
        rewrite ^/(.*)$ /public/{{project.owner}}/{{project.name}}/alias/{{alias}}{{#if path}}{{path}}{{/if}}/$1 break;
        proxy_pass http://{{backendHost}}:{{backendPort}};
    }
}
`;

  const customDomainTemplate = `
# Custom domain: {{domain}}
server {
    listen 80;
    server_name {{domain}};
    location / {
        rewrite ^/(.*)$ /public/{{project.owner}}/{{project.name}}/alias/{{alias}}$1 break;
        proxy_pass http://{{backendHost}}:{{backendPort}};
    }
}
`;

  const redirectTemplate = `
# Redirect config: {{sourceDomain}} → {{targetDomain}}
server {
    listen 80;
    {{#if sslEnabled}}
    listen 443 ssl;
    http2 on;
    ssl_certificate {{sslCertPath}};
    ssl_certificate_key {{sslKeyPath}};
    {{/if}}
    server_name {{sourceDomain}};
    return {{redirectType}} {{protocol}}://{{targetDomain}}$request_uri;
}
`;

  beforeEach(async () => {
    mockReadFile = fs.readFile as jest.MockedFunction<typeof fs.readFile>;
    mockWriteFile = fs.writeFile as jest.MockedFunction<typeof fs.writeFile>;
    mockUnlink = fs.unlink as jest.MockedFunction<typeof fs.unlink>;
    mockAccess = fs.access as jest.MockedFunction<typeof fs.access>;

    // Mock template loading
    mockReadFile.mockImplementation((filepath: any) => {
      if (filepath.includes('subdomain.conf.hbs')) {
        return Promise.resolve(subdomainTemplate);
      }
      if (filepath.includes('custom-domain.conf.hbs')) {
        return Promise.resolve(customDomainTemplate);
      }
      if (filepath.includes('redirect.conf.hbs')) {
        return Promise.resolve(redirectTemplate);
      }
      return Promise.reject(new Error(`File not found: ${filepath}`));
    });

    // Mock file write
    mockWriteFile.mockResolvedValue(undefined);

    // Mock unlink
    mockUnlink.mockResolvedValue(undefined);

    // Mock access (file exists check)
    mockAccess.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NginxConfigService,
        { provide: FeatureFlagsService, useValue: mockFeatureFlagsService },
      ],
    }).compile();

    service = module.get<NginxConfigService>(NginxConfigService);

    // Manually trigger onModuleInit since we're in tests
    await service.onModuleInit();
  });

  afterEach(() => {
    jest.clearAllMocks();
    mockFeatureFlagsService.isEnabled.mockResolvedValue(true);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('should load templates on init', async () => {
      expect(mockReadFile).toHaveBeenCalledTimes(3);
      expect(mockReadFile).toHaveBeenCalledWith(
        expect.stringContaining('subdomain.conf.hbs'),
        'utf-8',
      );
      expect(mockReadFile).toHaveBeenCalledWith(
        expect.stringContaining('custom-domain.conf.hbs'),
        'utf-8',
      );
      expect(mockReadFile).toHaveBeenCalledWith(
        expect.stringContaining('redirect.conf.hbs'),
        'utf-8',
      );
    });
  });

  describe('generateConfig', () => {
    const mockProject = {
      owner: 'testowner',
      name: 'testrepo',
    };

    it('should generate subdomain config', async () => {
      const domainMapping = {
        id: 'domain-1',
        projectId: 'proj-1',
        domain: 'coverage.localhost',
        domainType: 'subdomain' as const,
        alias: 'production',
        path: '/apps/frontend/coverage',
        sslEnabled: false,
        isActive: true,
        isPublic: null, // Phase B5: inherit from alias/project
        unauthorizedBehavior: null,
        requiredRole: null,
        dnsVerified: true,
        createdBy: 'user-1',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
        sslExpiresAt: null,
        dnsVerifiedAt: null,
        nginxConfigPath: null,
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

      const config = await service.generateConfig(domainMapping, mockProject);

      expect(config).toContain('server_name coverage.localhost');
      expect(config).toContain('testowner');
      expect(config).toContain('testrepo');
      expect(config).toContain('production');
      expect(config).toContain('/apps/frontend/coverage');
    });

    it('should generate custom domain config', async () => {
      const domainMapping = {
        id: 'domain-2',
        projectId: 'proj-1',
        domain: 'custom.example.com',
        domainType: 'custom' as const,
        alias: 'production',
        path: null,
        sslEnabled: false,
        isActive: true,
        isPublic: null, // Phase B5: inherit from alias/project
        unauthorizedBehavior: null,
        requiredRole: null,
        dnsVerified: true,
        createdBy: 'user-1',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
        sslExpiresAt: null,
        dnsVerifiedAt: null,
        nginxConfigPath: null,
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

      const config = await service.generateConfig(domainMapping, mockProject);

      expect(config).toContain('server_name custom.example.com');
      expect(config).toContain('Custom domain');
    });

    it('should use "latest" as default alias', async () => {
      const domainMapping = {
        id: 'domain-3',
        projectId: 'proj-1',
        domain: 'test.localhost',
        domainType: 'subdomain' as const,
        alias: null,
        path: null,
        sslEnabled: false,
        isActive: true,
        isPublic: null, // Phase B5: inherit from alias/project
        unauthorizedBehavior: null,
        requiredRole: null,
        dnsVerified: true,
        createdBy: 'user-1',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
        sslExpiresAt: null,
        dnsVerifiedAt: null,
        nginxConfigPath: null,
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

      const config = await service.generateConfig(domainMapping, mockProject);

      expect(config).toContain('latest');
    });
  });

  describe('writeConfigFile', () => {
    it('should write config to temp file and return paths', async () => {
      const config = 'server { listen 80; }';
      const result = await service.writeConfigFile('domain-1', config);

      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('/tmp/domain-domain-1.conf'),
        config,
        'utf-8',
      );
      expect(result.tempPath).toContain('/tmp/domain-domain-1.conf');
      expect(result.finalPath).toContain('domain-domain-1.conf');
    });
  });

  describe('deleteConfigFile', () => {
    it('should delete existing config file', async () => {
      const configPath = '/etc/nginx/sites-enabled/domain-1.conf';

      await service.deleteConfigFile(configPath);

      expect(mockAccess).toHaveBeenCalledWith(configPath);
      expect(mockUnlink).toHaveBeenCalledWith(configPath);
    });

    it('should handle non-existent file gracefully', async () => {
      const configPath = '/etc/nginx/sites-enabled/nonexistent.conf';
      mockAccess.mockRejectedValue(new Error('ENOENT'));

      // Should not throw
      await expect(service.deleteConfigFile(configPath)).resolves.not.toThrow();
    });
  });

  describe('getConfigFilePath', () => {
    it('should return correct path for domain mapping', () => {
      const result = service.getConfigFilePath('domain-123');

      expect(result).toContain('domain-domain-123.conf');
    });
  });
});
