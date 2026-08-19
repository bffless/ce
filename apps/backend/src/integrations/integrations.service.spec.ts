import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { IntegrationsService, StoredIntegrationConfig } from './integrations.service';
import { GoogleCalendarOAuthService } from './google-calendar-oauth.service';
import { GoogleCalendarIntegrationKeys } from './google-calendar.interface';

// In-memory project settings store, keyed by projectId
const settingsStore = new Map<string, Record<string, unknown>>();

jest.mock('../db/client', () => {
  return {
    db: {
      // SELECT { settings } FROM projects WHERE id = ? LIMIT 1
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn((cond: any) => ({
            limit: jest.fn(async () => {
              const projectId: string = cond?._projectId ?? 'unknown';
              const settings = settingsStore.get(projectId);
              return settings ? [{ settings }] : [];
            }),
          })),
        })),
      })),

      // UPDATE projects SET settings = ?, updatedAt = ? WHERE id = ?
      update: jest.fn(() => ({
        set: jest.fn((vals: { settings: Record<string, unknown> }) => ({
          where: jest.fn(async (cond: any) => {
            const projectId: string = cond?._projectId ?? 'unknown';
            settingsStore.set(projectId, vals.settings);
          }),
        })),
      })),
    },
  };
});

// drizzle-orm `eq` returns an object that survives through `where(...)`. Replace
// it with a tagged shape carrying the projectId so the mocked db can identify
// which row is being queried.
jest.mock('drizzle-orm', () => {
  const actual = jest.requireActual('drizzle-orm');
  return {
    ...actual,
    eq: (_col: any, value: any) => ({ _projectId: value }),
  };
});

describe('IntegrationsService — google-calendar', () => {
  let service: IntegrationsService;
  const projectId = 'proj-1';

  beforeEach(async () => {
    settingsStore.clear();
    settingsStore.set(projectId, {});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntegrationsService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'ENCRYPTION_KEY') {
                // 32 bytes, base64-encoded
                return Buffer.alloc(32, 7).toString('base64');
              }
              return undefined;
            },
          },
        },
        // GoogleCalendarOAuthService is forwardRef'd into IntegrationsService.
        // For this spec we only exercise setConfig / getActiveConfig / getPublicConfig
        // which never touch the OAuth service, so a stub is enough.
        {
          provide: GoogleCalendarOAuthService,
          useValue: { getValidAccessToken: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(IntegrationsService);
  });

  it('round-trips a GoogleCalendarIntegrationKeys config through setConfig → getActiveConfig', async () => {
    const config: GoogleCalendarIntegrationKeys = {
      clientId: 'client-abc.apps.googleusercontent.com',
      clientSecret: 'shhh',
      accessToken: 'tok',
      refreshToken: 'rt',
      tokenExpiry: 1_700_000_000_000,
      connectedEmail: 'owner@example.com',
      availableCalendars: [
        { id: 'primary@x', summary: 'Primary', primary: true, timeZone: 'America/New_York' },
      ],
    };

    await service.setConfig(projectId, 'google-calendar', 'production', { ...config });
    const decrypted = (await service.getActiveConfig(
      projectId,
      'google-calendar',
      'production',
    )) as unknown as GoogleCalendarIntegrationKeys;

    expect(decrypted).toEqual(config);

    // Plaintext should not appear in stored settings
    const stored = settingsStore.get(projectId)!;
    const integrations = stored.integrations as Record<string, StoredIntegrationConfig>;
    const cipher = integrations['google-calendar'].production!.config;
    expect(cipher).not.toContain('shhh');
    expect(cipher).not.toContain('client-abc');
    expect(cipher.split(':')).toHaveLength(3); // iv:authTag:encrypted
  });

  it('exposes only PUBLIC_CONFIG_FIELDS via listIntegrations.publicConfig — never tokens or clientSecret', async () => {
    const config: GoogleCalendarIntegrationKeys = {
      clientId: 'cid',
      clientSecret: 'super-secret',
      accessToken: 'token-must-not-leak',
      refreshToken: 'rt-must-not-leak',
      tokenExpiry: 1_700_000_000_000,
      connectedEmail: 'owner@example.com',
      availableCalendars: [{ id: 'primary@x', summary: 'Primary', primary: true, timeZone: 'UTC' }],
    };

    await service.setConfig(projectId, 'google-calendar', 'production', { ...config });

    const integrations = await service.listIntegrations(projectId);
    const gc = integrations.find((i) => i.id === 'google-calendar');
    expect(gc).toBeDefined();
    expect(gc!.publicConfig).toEqual({
      connectedEmail: 'owner@example.com',
      availableCalendars: config.availableCalendars,
    });

    const json = JSON.stringify(gc);
    expect(json).not.toContain('super-secret');
    expect(json).not.toContain('token-must-not-leak');
    expect(json).not.toContain('rt-must-not-leak');
  });

  it('listIntegrations returns google-calendar in the supported set', async () => {
    const integrations = await service.listIntegrations(projectId);
    const ids = integrations.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(['stripe', 'github', 'google-calendar']));
  });

  it('setConfig merges with existing config (refresh-only writes do not wipe credentials)', async () => {
    await service.setConfig(projectId, 'google-calendar', 'production', {
      clientId: 'cid',
      clientSecret: 'sec',
      refreshToken: 'rt',
      accessToken: 'old',
      tokenExpiry: 1,
    });

    // Simulate the refresh write — only the rotating fields
    await service.setConfig(projectId, 'google-calendar', 'production', {
      accessToken: 'fresh',
      tokenExpiry: 9_999_999_999_999,
    });

    const merged = (await service.getActiveConfig(
      projectId,
      'google-calendar',
      'production',
    )) as unknown as GoogleCalendarIntegrationKeys;

    expect(merged.accessToken).toBe('fresh');
    expect(merged.tokenExpiry).toBe(9_999_999_999_999);
    expect(merged.clientId).toBe('cid');
    expect(merged.clientSecret).toBe('sec');
    expect(merged.refreshToken).toBe('rt');
  });
});
