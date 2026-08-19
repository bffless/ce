import { ConfigService } from '@nestjs/config';
import { FeatureFlagsService } from './feature-flags.service';

/**
 * ce#584 — `setup.sh`'s Cloudflare branch writes `FEATURE_WILDCARD_SSL=false`
 * into `.env`. When the instance later moves to direct serving, that line kept
 * hiding the wildcard certificate flow — the only way to give an app subdomain
 * a certificate on that serving model.
 */
describe('FeatureFlagsService.reconcileWildcardSslVisibility', () => {
  let service: FeatureFlagsService;
  let setFlag: jest.SpyInstance;
  let getSources: jest.SpyInstance;

  beforeEach(() => {
    service = new FeatureFlagsService({
      get: jest.fn(() => './config/features.json'),
    } as unknown as ConfigService);
    setFlag = jest.spyOn(service, 'setFlag').mockResolvedValue({} as never);
    getSources = jest.spyOn(service as never, 'getSources' as never);
  });

  afterEach(() => jest.restoreAllMocks());

  it('re-enables the flag when moving to direct serving and env is what disabled it', async () => {
    getSources.mockResolvedValue({ env: false, source: 'env' });

    await service.reconcileWildcardSslVisibility('none');

    expect(setFlag).toHaveBeenCalledWith('ENABLE_WILDCARD_SSL', true);
  });

  it('leaves an explicit database override alone — the operator meant it', async () => {
    getSources.mockResolvedValue({ env: false, database: false, source: 'database' });

    await service.reconcileWildcardSslVisibility('none');

    expect(setFlag).not.toHaveBeenCalled();
  });

  it('does nothing when the flag is not disabled at all', async () => {
    getSources.mockResolvedValue({ default: true, source: 'default' });

    await service.reconcileWildcardSslVisibility('none');

    expect(setFlag).not.toHaveBeenCalled();
  });

  it.each(['cloudflare', 'proxy'] as const)(
    'never disables anything when moving to %s — one-directional by design',
    async (proxyMode) => {
      getSources.mockResolvedValue({ env: false, source: 'env' });

      await service.reconcileWildcardSslVisibility(proxyMode);

      expect(setFlag).not.toHaveBeenCalled();
    },
  );
});
