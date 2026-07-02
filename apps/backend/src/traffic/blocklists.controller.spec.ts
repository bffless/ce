import { ROLES_KEY } from '../auth/roles.guard';
import { BlocklistsController } from './blocklists.controller';
import { BlocklistService } from './blocklist.service';

// bcrypt is a native module the auth guards import transitively; mock it like
// the other guard specs do so the suite runs without the compiled binding.
jest.mock('bcrypt');
// BlocklistService imports the db client; keep this spec db-free.
jest.mock('../db/client', () => ({ db: {} }));

describe('BlocklistsController', () => {
  let controller: BlocklistsController;
  let service: jest.Mocked<BlocklistService>;

  beforeEach(() => {
    service = {
      getSettings: jest.fn(),
      setEnabled: jest.fn(),
      getBaselineEntries: jest.fn().mockReturnValue([]),
      listBlocklists: jest.fn(),
      getBlocklist: jest.fn(),
      createBlocklist: jest.fn(),
      updateBlocklist: jest.fn(),
      deleteBlocklist: jest.fn(),
      appendEntry: jest.fn(),
      getDomainBlocklistIds: jest.fn(),
      syncDomainBlocklists: jest.fn(),
    } as unknown as jest.Mocked<BlocklistService>;
    controller = new BlocklistsController(service);
  });

  it('is admin-only: every handler carries the admin roles metadata', () => {
    for (const handler of [
      controller.getSettings,
      controller.updateSettings,
      controller.getBaseline,
      controller.list,
      controller.create,
      controller.get,
      controller.update,
      controller.remove,
      controller.appendEntry,
      controller.getDomainBlocklists,
      controller.syncDomainBlocklists,
    ]) {
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual(['admin']);
    }
  });

  it('is guarded: controller declares ApiKeyGuard + RolesGuard', () => {
    const guards = Reflect.getMetadata('__guards__', BlocklistsController) ?? [];
    const guardNames = guards.map((g: any) => g.name);
    expect(guardNames).toEqual(expect.arrayContaining(['ApiKeyGuard', 'RolesGuard']));
  });

  it('delegates the master toggle to the service', async () => {
    service.setEnabled.mockResolvedValue({ enabled: false, baselineEntryCount: 200 });
    await expect(controller.updateSettings({ enabled: false })).resolves.toEqual({
      enabled: false,
      baselineEntryCount: 200,
    });
    expect(service.setEnabled).toHaveBeenCalledWith(false);
  });

  it('exposes the Baseline read-only', () => {
    expect(controller.getBaseline()).toEqual({ entries: [] });
  });

  it('delegates CRUD to the service', async () => {
    await controller.create({ name: 'list' });
    expect(service.createBlocklist).toHaveBeenCalledWith({ name: 'list' });

    await controller.update('b1', { description: 'd' });
    expect(service.updateBlocklist).toHaveBeenCalledWith('b1', { description: 'd' });

    await controller.remove('b1');
    expect(service.deleteBlocklist).toHaveBeenCalledWith('b1');
  });

  it('delegates the inline entry append to the service (#393)', async () => {
    await controller.appendEntry('b1', { matchType: 'prefix', value: '/wp-extra' });
    expect(service.appendEntry).toHaveBeenCalledWith('b1', {
      matchType: 'prefix',
      value: '/wp-extra',
    });
  });

  it('delegates domain attachment reads and writes to the service (#393)', async () => {
    service.getDomainBlocklistIds.mockResolvedValue(['b1']);
    await expect(controller.getDomainBlocklists('dom-1')).resolves.toEqual({
      domainMappingId: 'dom-1',
      blocklistIds: ['b1'],
    });

    await controller.syncDomainBlocklists('dom-1', { blocklistIds: ['b1', 'b2'] });
    expect(service.syncDomainBlocklists).toHaveBeenCalledWith('dom-1', ['b1', 'b2']);
  });
});
