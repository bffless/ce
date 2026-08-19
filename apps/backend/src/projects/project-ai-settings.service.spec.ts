import { ConfigService } from '@nestjs/config';
import { ProjectAISettingsService } from './project-ai-settings.service';

describe('ProjectAISettingsService', () => {
  const buildService = () => {
    const key = Buffer.alloc(32, 7).toString('base64');
    const configService = {
      get: jest.fn().mockReturnValue(key),
    } as unknown as ConfigService;
    return new ProjectAISettingsService(configService);
  };

  /** Stub /v1/models with the given ids. */
  const mockModelsResponse = (ids: string[]) => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: ids.map((id) => ({ id })) }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  };

  // Distinct keys per test so the per-key models cache never bleeds across cases.
  let keySeq = 0;
  const uniqueKey = () => `sk-ant-test-key-${keySeq++}`;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('previewProviderModels — live Anthropic model ids', () => {
    it('strips the dated suffix from a two-segment version', async () => {
      mockModelsResponse(['claude-haiku-4-5-20251001']);
      const service = buildService();

      const result = await service.previewProviderModels('anthropic', uniqueKey());

      expect(result.models.map((m) => m.id)).toEqual(['claude-haiku-4-5']);
    });

    it('strips the dated suffix from a single-segment gen-5 version', async () => {
      mockModelsResponse(['claude-sonnet-5-20260101']);
      const service = buildService();

      const result = await service.previewProviderModels('anthropic', uniqueKey());

      expect(result.models.map((m) => m.id)).toEqual(['claude-sonnet-5']);
    });

    it('strips the dated suffix from a single-segment fable id', async () => {
      mockModelsResponse(['claude-fable-5-20260301']);
      const service = buildService();

      const result = await service.previewProviderModels('anthropic', uniqueKey());

      expect(result.models.map((m) => m.id)).toEqual(['claude-fable-5']);
    });

    it('leaves a dated gen-4 single-segment id untouched (its alias is -0, not bare)', async () => {
      mockModelsResponse(['claude-opus-4-20250514']);
      const service = buildService();

      const result = await service.previewProviderModels('anthropic', uniqueKey());

      expect(result.models.map((m) => m.id)).toEqual(['claude-opus-4-20250514']);
    });

    it('leaves a legacy 3.x id untouched', async () => {
      mockModelsResponse(['claude-3-5-sonnet-20241022']);
      const service = buildService();

      const result = await service.previewProviderModels('anthropic', uniqueKey());

      expect(result.models.map((m) => m.id)).toEqual(['claude-3-5-sonnet-20241022']);
    });

    it('dedupes an alias and its dated snapshot down to one entry', async () => {
      mockModelsResponse(['claude-sonnet-5', 'claude-sonnet-5-20260101']);
      const service = buildService();

      const result = await service.previewProviderModels('anthropic', uniqueKey());

      expect(result.models.map((m) => m.id)).toEqual(['claude-sonnet-5']);
    });

    it('classifies families into tiers', async () => {
      mockModelsResponse(['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5']);
      const service = buildService();

      const result = await service.previewProviderModels('anthropic', uniqueKey());

      expect(result.models.map((m) => [m.id, m.tier])).toEqual([
        ['claude-opus-4-8', 'premium'],
        ['claude-sonnet-5', 'balanced'],
        ['claude-haiku-4-5', 'economy'],
      ]);
    });
  });

  describe('previewProviderModels — reporting live vs fallback', () => {
    it('reports live:true when the provider list is fetched successfully', async () => {
      mockModelsResponse(['claude-opus-4-8']);
      const service = buildService();

      const result = await service.previewProviderModels('anthropic', uniqueKey());

      expect(result.live).toBe(true);
    });

    it('reports live:false and falls back when the fetch throws', async () => {
      global.fetch = jest
        .fn()
        .mockRejectedValue(
          new Error('getaddrinfo ENOTFOUND api.anthropic.com'),
        ) as unknown as typeof fetch;
      const service = buildService();

      const result = await service.previewProviderModels('anthropic', uniqueKey());

      expect(result.live).toBe(false);
      expect(result.models.length).toBeGreaterThan(0);
    });

    it('reports live:false and falls back on a non-200 response', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue({ ok: false, status: 401 }) as unknown as typeof fetch;
      const service = buildService();

      const result = await service.previewProviderModels('anthropic', uniqueKey());

      expect(result.live).toBe(false);
      expect(result.models.length).toBeGreaterThan(0);
    });

    it('reports live:false without calling the provider when no key is supplied', async () => {
      const fetchMock = mockModelsResponse([]);
      const service = buildService();

      const result = await service.previewProviderModels('anthropic', '');

      expect(result.live).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reports live:false for providers with no live listing implemented', async () => {
      const fetchMock = mockModelsResponse([]);
      const service = buildService();

      const result = await service.previewProviderModels('openai', uniqueKey());

      expect(result.live).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('previewProviderModels — distinguishing why a fallback was used', () => {
    it('blames the fetch when the provider is reachable but errors', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;
      const service = buildService();

      const result = await service.previewProviderModels('anthropic', uniqueKey());

      expect(result.fallbackReason).toBe('fetch_failed');
    });

    it('blames the missing key, not the fetch, when no key is supplied', async () => {
      const service = buildService();

      const result = await service.previewProviderModels('anthropic', '');

      expect(result.fallbackReason).toBe('no_key');
    });

    it('blames the provider, not the fetch, when live listing is unsupported', async () => {
      const service = buildService();

      const result = await service.previewProviderModels('openai', uniqueKey());

      expect(result.fallbackReason).toBe('unsupported_provider');
    });

    it('reports no fallbackReason on a live list', async () => {
      mockModelsResponse(['claude-opus-4-8']);
      const service = buildService();

      const result = await service.previewProviderModels('anthropic', uniqueKey());

      expect(result.fallbackReason).toBeUndefined();
    });
  });
});
