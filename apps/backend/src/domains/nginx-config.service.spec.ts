import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NginxConfigService } from './nginx-config.service';
import { EdgeBlocklistService } from './edge-blocklist.service';
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

// Mock EdgeBlocklistService (edge rules empty by default; tests override)
const mockEdgeBlocklistService = {
  getServerRules: jest.fn().mockReturnValue(''),
  sync: jest.fn().mockResolvedValue(false),
};

// Mock ConfigService
const mockConfigService = {
  get: jest.fn().mockImplementation((key: string, defaultValue?: string) => {
    const config: Record<string, string> = {
      PRIMARY_DOMAIN: 'example.com',
      BACKEND_HOST: 'backend',
      BACKEND_PORT: '3000',
      PLATFORM_MODE: 'false',
      PROXY_MODE: 'none',
    };
    return config[key] ?? defaultValue;
  }),
};

describe('NginxConfigService', () => {
  let service: NginxConfigService;
  let mockReadFile: jest.MockedFunction<typeof fs.readFile>;
  let mockWriteFile: jest.MockedFunction<typeof fs.writeFile>;
  let mockUnlink: jest.MockedFunction<typeof fs.unlink>;
  let mockAccess: jest.MockedFunction<typeof fs.access>;

  const subdomainTemplate = `
# Generated config for domain mapping: {{domain}}
{{#if sslEnabled}}
server {
    listen 443 ssl;
    server_name {{domain}};
    ssl_certificate {{sslCertPath}};
    ssl_certificate_key {{sslCertKeyPath}};
    location / {
        rewrite ^/(.*)$ /public/{{project.owner}}/{{project.name}}/alias/{{alias}}{{#if path}}{{path}}{{/if}}/$1 break;
        proxy_pass http://{{backendHost}}:{{backendPort}};
    }
}
{{else}}
server {
    listen 80;
    server_name {{domain}};
    location / {
        rewrite ^/(.*)$ /public/{{project.owner}}/{{project.name}}/alias/{{alias}}{{#if path}}{{path}}{{/if}}/$1 break;
        proxy_pass http://{{backendHost}}:{{backendPort}};
    }
}
{{/if}}
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
        { provide: ConfigService, useValue: mockConfigService },
        { provide: EdgeBlocklistService, useValue: mockEdgeBlocklistService },
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
        redirectType: '301' as const,
      };

      const config = await service.generateConfig(domainMapping, mockProject);

      expect(config).toContain('server_name coverage.localhost');
      expect(config).toContain('testowner');
      expect(config).toContain('testrepo');
      expect(config).toContain('production');
      expect(config).toContain('/apps/frontend/coverage');
      // #393: edge rules are resolved for THIS mapping's effective set.
      expect(mockEdgeBlocklistService.getServerRules).toHaveBeenCalledWith('444', 'domain-1');
    });

    // Regression: redirect targets that are absolute external URLs must be emitted
    // verbatim. Previously they were forced to start with "/", so nginx produced
    // `return 302 /https://discord.gg/...`, which the browser resolved relative to
    // the host (-> example.com/https://discord.gg/...) instead of redirecting out.
    it('should emit absolute external URL redirect targets without a leading slash', async () => {
      const domainMapping = {
        id: 'domain-redir',
        projectId: 'proj-1',
        domain: 'app.example.com',
        domainType: 'subdomain' as const,
        alias: 'production',
        path: null,
        sslEnabled: false,
        isActive: true,
        isPublic: null,
        unauthorizedBehavior: null,
        requiredRole: null,
        dnsVerified: true,
        createdBy: 'user-1',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
        sslExpiresAt: null,
        dnsVerifiedAt: null,
        nginxConfigPath: null,
        autoRenewSsl: true,
        sslRenewedAt: null,
        sslRenewalStatus: null,
        sslRenewalError: null,
        stickySessionsEnabled: true,
        stickySessionDuration: 86400,
        isSpa: false,
        isPrimary: false,
        wwwBehavior: null,
        redirectTarget: null,
        redirectType: '301' as const,
      };

      const config = await service.generateConfig(domainMapping, mockProject, undefined, [
        {
          sourcePath: '/discord',
          targetPath: 'https://discord.gg/CaRsVzuE',
          redirectType: '302' as const,
          priority: '100',
        },
        {
          sourcePath: '/old-page',
          targetPath: '/new-page',
          redirectType: '301' as const,
          priority: '100',
        },
      ]);

      // Absolute URL passes through untouched (redirects off-site).
      expect(config).toContain('return 302 https://discord.gg/CaRsVzuE;');
      expect(config).not.toContain('return 302 /https://discord.gg/CaRsVzuE');
      // Relative same-domain targets still work as before.
      expect(config).toContain('return 301 /new-page;');
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
        redirectType: '301' as const,
      };

      const config = await service.generateConfig(domainMapping, mockProject);

      expect(config).toContain('server_name custom.example.com');
      expect(config).toContain('Custom domain');
    });

    it('should emit 443 with Cloudflare Origin Cert for subdomains when PROXY_MODE=cloudflare', async () => {
      mockFeatureFlagsService.isEnabled.mockResolvedValue(false);
      mockConfigService.get.mockImplementation((key: string, defaultValue?: string) => {
        const config: Record<string, string> = {
          PRIMARY_DOMAIN: 'example.com',
          BACKEND_HOST: 'backend',
          BACKEND_PORT: '3000',
          PLATFORM_MODE: 'false',
          PROXY_MODE: 'cloudflare',
        };
        return config[key] ?? defaultValue;
      });

      const domainMapping = {
        id: 'domain-cf',
        projectId: 'proj-1',
        domain: 'app.example.com',
        domainType: 'subdomain' as const,
        alias: 'production',
        path: null,
        sslEnabled: false,
        isActive: true,
        isPublic: null,
        unauthorizedBehavior: null,
        requiredRole: null,
        dnsVerified: true,
        createdBy: 'user-1',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
        sslExpiresAt: null,
        dnsVerifiedAt: null,
        nginxConfigPath: null,
        autoRenewSsl: true,
        sslRenewedAt: null,
        sslRenewalStatus: null,
        sslRenewalError: null,
        stickySessionsEnabled: true,
        stickySessionDuration: 86400,
        isSpa: false,
        isPrimary: false,
        wwwBehavior: null,
        redirectTarget: null,
        redirectType: '301' as const,
      };

      const config = await service.generateConfig(domainMapping, mockProject);

      expect(config).toContain('listen 443 ssl');
      expect(config).toContain('ssl_certificate /etc/nginx/ssl/fullchain.pem');
      expect(config).toContain('ssl_certificate_key /etc/nginx/ssl/privkey.pem');
      expect(config).not.toContain('wildcard.');
    });

    it('should emit 443 with Let’s Encrypt wildcard cert when ENABLE_WILDCARD_SSL=true', async () => {
      mockFeatureFlagsService.isEnabled.mockResolvedValue(true);

      const domainMapping = {
        id: 'domain-le',
        projectId: 'proj-1',
        domain: 'app.example.com',
        domainType: 'subdomain' as const,
        alias: 'production',
        path: null,
        sslEnabled: true,
        isActive: true,
        isPublic: null,
        unauthorizedBehavior: null,
        requiredRole: null,
        dnsVerified: true,
        createdBy: 'user-1',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
        sslExpiresAt: null,
        dnsVerifiedAt: null,
        nginxConfigPath: null,
        autoRenewSsl: true,
        sslRenewedAt: null,
        sslRenewalStatus: null,
        sslRenewalError: null,
        stickySessionsEnabled: true,
        stickySessionDuration: 86400,
        isSpa: false,
        isPrimary: false,
        wwwBehavior: null,
        redirectTarget: null,
        redirectType: '301' as const,
      };

      const config = await service.generateConfig(domainMapping, mockProject);

      expect(config).toContain('listen 443 ssl');
      // baseDomain comes from process.env.PRIMARY_DOMAIN (defaults to "localhost" in tests)
      expect(config).toContain('ssl_certificate /etc/nginx/ssl/wildcard.localhost.crt');
      expect(config).toContain('ssl_certificate_key /etc/nginx/ssl/wildcard.localhost.key');
    });

    it('should fall back to HTTP-only for subdomains when no wildcard cert and PROXY_MODE!=cloudflare', async () => {
      mockFeatureFlagsService.isEnabled.mockResolvedValue(false);
      mockConfigService.get.mockImplementation((key: string, defaultValue?: string) => {
        const config: Record<string, string> = {
          PRIMARY_DOMAIN: 'example.com',
          BACKEND_HOST: 'backend',
          BACKEND_PORT: '3000',
          PLATFORM_MODE: 'false',
          PROXY_MODE: 'none',
        };
        return config[key] ?? defaultValue;
      });

      const domainMapping = {
        id: 'domain-http',
        projectId: 'proj-1',
        domain: 'app.example.com',
        domainType: 'subdomain' as const,
        alias: 'production',
        path: null,
        sslEnabled: true, // even when set true at the db level
        isActive: true,
        isPublic: null,
        unauthorizedBehavior: null,
        requiredRole: null,
        dnsVerified: true,
        createdBy: 'user-1',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
        sslExpiresAt: null,
        dnsVerifiedAt: null,
        nginxConfigPath: null,
        autoRenewSsl: true,
        sslRenewedAt: null,
        sslRenewalStatus: null,
        sslRenewalError: null,
        stickySessionsEnabled: true,
        stickySessionDuration: 86400,
        isSpa: false,
        isPrimary: false,
        wwwBehavior: null,
        redirectTarget: null,
        redirectType: '301' as const,
      };

      const config = await service.generateConfig(domainMapping, mockProject);

      expect(config).toContain('listen 80');
      expect(config).not.toContain('listen 443 ssl');
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
        redirectType: '301' as const,
      };

      const config = await service.generateConfig(domainMapping, mockProject);

      expect(config).toContain('latest');
    });

    it('routes isPrimary mappings to the primary-domain generator (SPA + www + auth relay survive regeneration)', async () => {
      // Regression: regeneration paths (startup, proxy-rule changes) funnel
      // primary mappings through generateConfig. Without an isPrimary branch they
      // fell through to the custom-domain template, dropping SPA mode + www
      // handling until the next explicit domain save.
      const domainMapping = {
        id: 'domain-primary',
        projectId: 'proj-1',
        domain: 'example.com',
        domainType: 'custom' as const,
        alias: 'production',
        path: '/dist',
        sslEnabled: true,
        isActive: true,
        isPublic: null,
        unauthorizedBehavior: null,
        requiredRole: null,
        dnsVerified: true,
        createdBy: 'user-1',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
        sslExpiresAt: null,
        dnsVerifiedAt: null,
        nginxConfigPath: null,
        autoRenewSsl: true,
        sslRenewedAt: null,
        sslRenewalStatus: null,
        sslRenewalError: null,
        stickySessionsEnabled: true,
        stickySessionDuration: 86400,
        isSpa: true,
        isPrimary: true,
        wwwBehavior: 'serve-both' as const,
        redirectTarget: null,
        redirectType: '301' as const,
      };

      const config = await service.generateConfig(domainMapping, mockProject);

      // Primary-domain generator output, not the custom-domain template
      expect(config).toContain('Primary Domain Configuration');
      // www handling preserved (serve-both → "server_name <base> www.<base>").
      // server_name comes from getBaseDomain(), not domainMapping.domain.
      expect(config).toContain('www.');
      // SPA fallback present because isSpa is true
      expect(config).toContain('@spa_fallback');
      // BFFless auth relay proxied (not swallowed by SPA fallback)
      expect(config).toContain('location /_bffless/auth/');
    });
  });

  describe('generateRedirectDomainConfig', () => {
    it('defaults to 301 when redirectType is not provided', () => {
      const config = service.generateRedirectDomainConfig({
        id: 'dm-1',
        domain: 'old-brand.example.com',
        redirectTarget: 'new-brand.example.com',
        sslEnabled: false,
      });

      expect(config).toContain('return 301 https://new-brand.example.com$request_uri');
      expect(config).not.toContain('return 302');
      expect(config).toContain('server_name old-brand.example.com');
    });

    it('emits a 302 redirect when redirectType is "302"', () => {
      const config = service.generateRedirectDomainConfig({
        id: 'dm-2',
        domain: 'temp.example.com',
        redirectTarget: 'new.example.com',
        redirectType: '302',
        sslEnabled: false,
      });

      expect(config).toContain('return 302 https://new.example.com$request_uri');
      expect(config).not.toContain('return 301 https://new.example.com');
    });

    it('emits a 301 redirect when redirectType is explicitly "301"', () => {
      const config = service.generateRedirectDomainConfig({
        id: 'dm-3',
        domain: 'perm.example.com',
        redirectTarget: 'new.example.com',
        redirectType: '301',
        sslEnabled: false,
      });

      expect(config).toContain('return 301 https://new.example.com$request_uri');
    });

    it('applies redirectType to both HTTP and HTTPS server blocks when SSL is enabled', () => {
      const config = service.generateRedirectDomainConfig({
        id: 'dm-4',
        domain: 'ssl.example.com',
        redirectTarget: 'new.example.com',
        redirectType: '302',
        sslEnabled: true,
      });

      const matches = config.match(/return 302 https:\/\/new\.example\.com\$request_uri/g);
      expect(matches).not.toBeNull();
      expect(matches!.length).toBeGreaterThanOrEqual(2);
      expect(config).not.toContain('return 301 https://new.example.com');
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
