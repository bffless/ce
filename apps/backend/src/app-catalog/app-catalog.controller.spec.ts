import { AppCatalogController } from './app-catalog.controller';
import { REQUIRED_FLAGS_KEY } from '../feature-flags/feature-flag.guard';
import { ROLES_KEY } from '../auth/roles.guard';

describe('AppCatalogController guards', () => {
  it('requires the ENABLE_APP_CATALOG feature flag', () => {
    const flags = Reflect.getMetadata(REQUIRED_FLAGS_KEY, AppCatalogController);
    expect(flags).toEqual(['ENABLE_APP_CATALOG']);
  });

  it('requires the admin role', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, AppCatalogController);
    expect(roles).toEqual(['admin']);
  });
});
