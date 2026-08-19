import { DomainTools, setTrafficWeightsParameters } from './domain.tools';

describe('traffic-splitting MCP tools', () => {
  const stubUser = () =>
    jest
      .spyOn(
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require('../helpers/user-context.helper'),
        'getUserContext',
      )
      .mockResolvedValue({ id: 'u1', role: 'admin', apiKeyProjectId: null });

  afterEach(() => jest.restoreAllMocks());

  describe('set_traffic_weights parameters schema', () => {
    it('accepts weights that sum to 100', () => {
      const parsed = setTrafficWeightsParameters.parse({
        domainId: 'd1',
        weights: [
          { alias: 'production', weight: 50 },
          { alias: 'red', weight: 50 },
        ],
      });
      expect(parsed.weights).toHaveLength(2);
    });

    it('rejects weights that do not sum to 100 with a clear message', () => {
      const result = setTrafficWeightsParameters.safeParse({
        domainId: 'd1',
        weights: [
          { alias: 'production', weight: 60 },
          { alias: 'red', weight: 30 },
        ],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toMatch(/sum to 100/i);
      }
    });

    it('rejects an empty weights array', () => {
      expect(setTrafficWeightsParameters.safeParse({ domainId: 'd1', weights: [] }).success).toBe(
        false,
      );
    });

    it('preserves the optional per-weight path', () => {
      const parsed = setTrafficWeightsParameters.parse({
        domainId: 'd1',
        weights: [
          { alias: 'production', weight: 50, path: 'site-v0/dist' },
          { alias: 'red', weight: 50, path: 'site-v1/dist' },
        ],
      });
      expect(parsed.weights[0].path).toBe('site-v0/dist');
    });
  });

  describe('setTrafficWeights', () => {
    it('forwards domainId, dto, and userId to TrafficRoutingService', async () => {
      const setTrafficWeights = jest.fn().mockResolvedValue({ weights: [] });
      const tools = new DomainTools({} as any, { setTrafficWeights } as any, {} as any, {} as any);
      stubUser();

      await tools.setTrafficWeights(
        {
          domainId: 'd1',
          weights: [
            { alias: 'production', weight: 50 },
            { alias: 'red', weight: 50 },
          ],
          stickySessionsEnabled: true,
        } as any,
        {} as any,
        { user: { id: 'u1' } } as any,
      );

      expect(setTrafficWeights).toHaveBeenCalledWith(
        'd1',
        expect.objectContaining({
          weights: expect.arrayContaining([expect.objectContaining({ alias: 'red', weight: 50 })]),
          stickySessionsEnabled: true,
        }),
        'u1',
      );
      // domainId must be split out of the dto forwarded to the service.
      expect(setTrafficWeights.mock.calls[0][1].domainId).toBeUndefined();
    });
  });

  describe('createTrafficRule', () => {
    it('splits domainId out and forwards the rule dto plus userId', async () => {
      const create = jest.fn().mockResolvedValue({ id: 'r1' });
      const tools = new DomainTools({} as any, {} as any, { create } as any, {} as any);
      stubUser();

      await tools.createTrafficRule(
        {
          domainId: 'd1',
          alias: 'canary',
          conditionType: 'query_param',
          conditionKey: 'v',
          conditionValue: 'canary',
          priority: 10,
        } as any,
        {} as any,
        { user: { id: 'u1' } } as any,
      );

      expect(create).toHaveBeenCalledWith(
        'd1',
        expect.objectContaining({
          alias: 'canary',
          conditionType: 'query_param',
          conditionKey: 'v',
          conditionValue: 'canary',
          priority: 10,
        }),
        'u1',
      );
      expect(create.mock.calls[0][1].domainId).toBeUndefined();
    });
  });

  describe('updateTrafficRule', () => {
    it('forwards ruleId separately from the patch dto', async () => {
      const update = jest.fn().mockResolvedValue({ id: 'r1' });
      const tools = new DomainTools({} as any, {} as any, { update } as any, {} as any);
      stubUser();

      await tools.updateTrafficRule(
        { ruleId: 'r1', priority: 5, isActive: false } as any,
        {} as any,
        { user: { id: 'u1' } } as any,
      );

      expect(update).toHaveBeenCalledWith(
        'r1',
        expect.objectContaining({ priority: 5, isActive: false }),
        'u1',
      );
      expect(update.mock.calls[0][1].ruleId).toBeUndefined();
    });
  });
});
