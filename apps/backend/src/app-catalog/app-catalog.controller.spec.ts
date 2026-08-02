import { AppCatalogController } from './app-catalog.controller';
import { AppCatalogService } from './app-catalog.service';
import { REQUIRED_FLAGS_KEY } from '../feature-flags/feature-flag.guard';
import { ROLES_KEY } from '../auth/roles.guard';
import type { CurrentUserData } from '../auth/decorators/current-user.decorator';

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

describe('AppCatalogController routes', () => {
  let controller: AppCatalogController;
  let catalog: jest.Mocked<AppCatalogService>;
  const user: CurrentUserData = { id: 'user-1', email: 'a@b.com', role: 'admin' };

  beforeEach(() => {
    catalog = {
      listCatalog: jest.fn().mockResolvedValue({ data: [] }),
      preflight: jest.fn().mockResolvedValue({ gates: [], syncPlans: [], appHost: null }),
      install: jest.fn().mockResolvedValue({ jobId: 'job-1' }),
      getJob: jest.fn().mockReturnValue({ id: 'job-1' }),
      undoJob: jest.fn().mockResolvedValue({ removed: [] }),
      updateInstalled: jest.fn().mockResolvedValue({ jobId: 'job-2' }),
      uninstallPreview: jest.fn().mockResolvedValue({ dataTables: [] }),
      uninstall: jest.fn().mockResolvedValue({ removed: {}, dataTables: {}, note: '' }),
      ejectPayload: jest.fn().mockResolvedValue({ repo: 'bffless/apps' }),
    } as unknown as jest.Mocked<AppCatalogService>;
    controller = new AppCatalogController(catalog);
  });

  it('list() delegates to catalog.listCatalog()', async () => {
    const result = await controller.list();
    expect(catalog.listCatalog).toHaveBeenCalledWith();
    expect(result).toEqual({ data: [] });
  });

  it('preflight() delegates with appId, body, and the current user id', async () => {
    const body = { projectId: 'proj-1' };
    await controller.preflight('handoff', body as never, user);
    expect(catalog.preflight).toHaveBeenCalledWith('handoff', body, 'user-1');
  });

  it('install() delegates with appId, body, and the current user id', async () => {
    const body = { newProject: { owner: 'acme', name: 'site' } };
    const result = await controller.install('handoff', body as never, user);
    expect(catalog.install).toHaveBeenCalledWith('handoff', body, 'user-1');
    expect(result).toEqual({ jobId: 'job-1' });
  });

  it('getJob() delegates to catalog.getJob(jobId)', async () => {
    const result = await controller.getJob('job-1');
    expect(catalog.getJob).toHaveBeenCalledWith('job-1');
    expect(result).toEqual({ id: 'job-1' });
  });

  it('undoJob() delegates with jobId and the current user id', async () => {
    await controller.undoJob('job-1', user);
    expect(catalog.undoJob).toHaveBeenCalledWith('job-1', 'user-1');
  });

  it('update() delegates with id, prune (defaulted false), and the current user id', async () => {
    await controller.update('ia-1', {}, user);
    expect(catalog.updateInstalled).toHaveBeenCalledWith('ia-1', false, 'user-1');
  });

  it('update() passes through an explicit prune: true', async () => {
    await controller.update('ia-1', { prune: true }, user);
    expect(catalog.updateInstalled).toHaveBeenCalledWith('ia-1', true, 'user-1');
  });

  it('uninstallPreview() delegates to catalog.uninstallPreview(id)', async () => {
    await controller.uninstallPreview('ia-1');
    expect(catalog.uninstallPreview).toHaveBeenCalledWith('ia-1');
  });

  it('uninstall() delegates with id, deleteData (defaulted false), and the current user id', async () => {
    await controller.uninstall('ia-1', {}, user);
    expect(catalog.uninstall).toHaveBeenCalledWith('ia-1', false, 'user-1');
  });

  it('uninstall() passes through an explicit deleteData: true', async () => {
    await controller.uninstall('ia-1', { deleteData: true }, user);
    expect(catalog.uninstall).toHaveBeenCalledWith('ia-1', true, 'user-1');
  });

  it('eject() delegates to catalog.ejectPayload(id)', async () => {
    await controller.eject('ia-1');
    expect(catalog.ejectPayload).toHaveBeenCalledWith('ia-1');
  });

  it('exposes no manual-step acknowledgement handler', () => {
    expect((controller as unknown as Record<string, unknown>).ack).toBeUndefined();
  });
});
