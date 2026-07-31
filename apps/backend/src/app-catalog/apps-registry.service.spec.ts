import { ConfigService } from '@nestjs/config';
import { AppsRegistryService } from './apps-registry.service';
import { TEST_MANIFEST } from './app-manifest.util.spec';

const VALID_REGISTRY = {
  schemaVersion: 1,
  apps: [
    {
      id: TEST_MANIFEST.id,
      name: TEST_MANIFEST.name,
      version: TEST_MANIFEST.version,
      bundleUrl: 'https://example.com/handoff.zip',
      sha256: 'a'.repeat(64),
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('AppsRegistryService', () => {
  let configService: ConfigService;
  let service: AppsRegistryService;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    configService = new ConfigService({});
    service = new AppsRegistryService(configService);
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('returns parsed registry on 200 with valid JSON', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(VALID_REGISTRY));

    const result = await service.getRegistry();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.registry).toEqual(VALID_REGISTRY);
      expect(typeof result.fetchedAt).toBe('string');
    }
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('does not refetch within the TTL', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(VALID_REGISTRY));

    await service.getRegistry();
    await service.getRegistry();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('refetches when force is true', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(VALID_REGISTRY));

    await service.getRegistry();
    await service.getRegistry(true);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('degrades to ok:false on network error with no prior cache', async () => {
    fetchSpy.mockRejectedValue(new Error('network down'));

    const result = await service.getRegistry();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeTruthy();
    }
  });

  it('degrades to ok:false on non-200 response with no prior cache', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({}, 500));

    const result = await service.getRegistry();

    expect(result.ok).toBe(false);
  });

  it('degrades to ok:false on invalid registry JSON with no prior cache', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ schemaVersion: 1, apps: 'not-an-array' }));

    const result = await service.getRegistry();

    expect(result.ok).toBe(false);
  });

  it('serves the stale cache with ok:true when a later refresh fails, even past TTL', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(VALID_REGISTRY));
    const first = await service.getRegistry();
    expect(first.ok).toBe(true);

    // Simulate TTL expiry by forcing a refetch attempt that fails.
    fetchSpy.mockRejectedValueOnce(new Error('registry blip'));
    const second = await service.getRegistry(true);

    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.registry).toEqual(VALID_REGISTRY);
    }

    // A non-200 blip after that must also serve the stale cache.
    fetchSpy.mockResolvedValueOnce(jsonResponse({}, 503));
    const third = await service.getRegistry(true);
    expect(third.ok).toBe(true);
    if (third.ok) {
      expect(third.registry).toEqual(VALID_REGISTRY);
    }
  });
});
