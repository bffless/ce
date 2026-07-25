import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

// Mock the db client with a thenable chainable: every builder method returns
// the chain, and awaiting the chain consumes the next queued result (in the
// order the service awaits its queries). Mirrors request-log.service.spec.
jest.mock('../db/client', () => {
  const queued: unknown[] = [];
  const methods = [
    'select',
    'from',
    'innerJoin',
    'where',
    'orderBy',
    'limit',
    'insert',
    'values',
    'onConflictDoNothing',
    'update',
    'set',
    'delete',
    'returning',
  ];
  const chainable: Record<string, unknown> = {};
  for (const method of methods) {
    chainable[method] = jest.fn(() => chainable);
  }
  chainable.then = (
    resolve: (value: unknown) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve(queued.length > 0 ? queued.shift() : []).then(resolve, reject);
  chainable.transaction = jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(chainable));
  chainable.__queue = (result: unknown) => queued.push(result);
  chainable.__reset = () => {
    queued.length = 0;
    for (const method of methods) {
      (chainable[method] as jest.Mock).mockClear();
    }
  };
  return { db: chainable };
});

import { db } from '../db/client';
import { BlocklistService, BOT_PROTECTION_FLAG } from './blocklist.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';

const mockDb = db as unknown as Record<string, jest.Mock> & {
  __queue: (result: unknown) => void;
  __reset: () => void;
};

const listRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'b1',
  name: 'my-list',
  description: null,
  isDefault: true,
  createdAt: new Date('2026-07-01T00:00:00Z'),
  updatedAt: new Date('2026-07-01T00:00:00Z'),
  ...overrides,
});

const entryRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'e1',
  blocklistId: 'b1',
  kind: 'block',
  matchType: 'prefix',
  value: '/custom-probe',
  createdAt: new Date('2026-07-01T00:00:00Z'),
  ...overrides,
});

describe('BlocklistService', () => {
  let service: BlocklistService;
  let featureFlags: jest.Mocked<FeatureFlagsService>;

  beforeEach(() => {
    mockDb.__reset();
    featureFlags = {
      isEnabled: jest.fn().mockResolvedValue(true),
      setFlag: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<FeatureFlagsService>;
    service = new BlocklistService(featureFlags);
  });

  describe('enforcement state (refresh + shouldBlock)', () => {
    it('enforces the Baseline before any refresh (protected by default)', () => {
      expect(service.shouldBlock('/wp-login.php')).toBe(true);
      expect(service.shouldBlock('/index.html')).toBe(false);
    });

    it('after refresh with the toggle on, Baseline + list patterns block and allowlists win', async () => {
      mockDb.__queue([listRow()]); // listBlocklists: lists
      mockDb.__queue([
        entryRow(),
        entryRow({ id: 'e2', kind: 'allow', matchType: 'exact', value: '/status' }),
      ]); // listBlocklists: entries
      mockDb.__queue([]); // listBlocklists: attachments
      mockDb.__queue([]); // refresh: domain mappings
      await service.refresh();

      expect(service.shouldBlock('/custom-probe/x')).toBe(true); // list pattern
      expect(service.shouldBlock('/.env')).toBe(true); // Baseline
      expect(service.shouldBlock('/status')).toBe(false); // allowlist rescues a Baseline block
      expect(service.shouldBlock('/index.html')).toBe(false);
    });

    it('blocks nothing when the master toggle is off', async () => {
      featureFlags.isEnabled.mockResolvedValue(false);
      mockDb.__queue([]); // listBlocklists: no lists
      mockDb.__queue([]); // refresh: domain mappings
      await service.refresh();

      expect(service.shouldBlock('/wp-login.php')).toBe(false);
      expect(service.shouldBlock('/.env')).toBe(false);
    });

    it('keeps the last good matcher when a refresh fails', async () => {
      mockDb.__queue([]); // successful refresh: Baseline only, enabled
      mockDb.__queue([]); // refresh: domain mappings
      await service.refresh();
      expect(service.shouldBlock('/.env')).toBe(true);

      featureFlags.isEnabled.mockRejectedValue(new Error('db down'));
      await service.refresh();
      expect(service.shouldBlock('/.env')).toBe(true);
    });

    it('falls back to Baseline-only enforcement when the lists cannot load', async () => {
      const failure = {
        then: (_resolve: unknown, reject: (reason: unknown) => void) =>
          reject(new Error('relation does not exist')),
      };
      mockDb.orderBy.mockImplementationOnce(() => failure);
      await service.refresh();

      expect(service.shouldBlock('/.env')).toBe(true);
    });
  });

  describe('compiled state + change listeners (edge enforcement, #392)', () => {
    it('exposes the compiled sources the matcher enforces', async () => {
      mockDb.__queue([]); // listBlocklists: no lists
      mockDb.__queue([]); // refresh: domain mappings
      await service.refresh();

      const state = service.getCompiledState();
      expect(state.enabled).toBe(true);
      expect(state.blockSource).toContain('^/wp-admin');
      expect(state.allowSource).toBeNull();
    });

    it('does not fire listeners on the initial load or unchanged refreshes', async () => {
      const listener = jest.fn();
      service.onEffectiveChange(listener);

      mockDb.__queue([]); // first refresh: lists
      mockDb.__queue([]); // first refresh: domain mappings
      await service.refresh();
      mockDb.__queue([]); // identical second refresh (interval re-sync)
      mockDb.__queue([]);
      await service.refresh();

      expect(listener).not.toHaveBeenCalled();
    });

    it('notifies on the first successful refresh after the boot refresh failed outright (#531)', async () => {
      // Live incident: the outer catch (e.g. featureFlags.isEnabled() throwing
      // because postgres isn't ready yet) used to leave lastFingerprint null,
      // so the next successful refresh's null-guard suppressed notification
      // and NginxStartupService's Baseline-only render was never corrected.
      const listener = jest.fn();
      service.onEffectiveChange(listener);

      featureFlags.isEnabled.mockRejectedValueOnce(new Error('connection refused'));
      await service.refresh(); // boot refresh: outer catch, Baseline-only stands
      expect(listener).not.toHaveBeenCalled();

      mockDb.__queue([listRow()]);
      mockDb.__queue([entryRow()]);
      mockDb.__queue([]); // attachments
      mockDb.__queue([]); // domain mappings
      await service.refresh(); // first successful refresh after the failure
      expect(listener).toHaveBeenCalledTimes(1);
      expect(service.shouldBlock('/custom-probe')).toBe(true);
    });

    it('fires listeners when the effective set changes (mutation or toggle flip)', async () => {
      const listener = jest.fn();
      service.onEffectiveChange(listener);

      mockDb.__queue([]); // initial load: Baseline only, lists
      mockDb.__queue([]); // initial load: domain mappings
      await service.refresh();

      mockDb.__queue([listRow()]);
      mockDb.__queue([entryRow()]); // a list appears
      mockDb.__queue([]); // attachments
      mockDb.__queue([]); // domain mappings
      await service.refresh();
      expect(listener).toHaveBeenCalledTimes(1);

      featureFlags.isEnabled.mockResolvedValue(false); // toggle flips
      mockDb.__queue([listRow()]);
      mockDb.__queue([entryRow()]);
      mockDb.__queue([]);
      mockDb.__queue([]);
      await service.refresh();
      expect(listener).toHaveBeenCalledTimes(2);
    });

    it('a throwing listener never breaks refresh or the other listeners', async () => {
      const second = jest.fn();
      service.onEffectiveChange(() => {
        throw new Error('boom');
      });
      service.onEffectiveChange(second);

      mockDb.__queue([]); // initial load: lists
      mockDb.__queue([]); // initial load: domain mappings
      await service.refresh();
      mockDb.__queue([listRow()]);
      mockDb.__queue([entryRow()]); // change
      mockDb.__queue([]); // attachments
      mockDb.__queue([]); // domain mappings
      await service.refresh();

      expect(second).toHaveBeenCalledTimes(1);
      expect(service.shouldBlock('/custom-probe')).toBe(true);
    });
  });

  describe('settings', () => {
    it('reports the toggle and Baseline size', async () => {
      const settings = await service.getSettings();
      expect(settings.enabled).toBe(true);
      expect(settings.baselineEntryCount).toBeGreaterThan(150);
      expect(featureFlags.isEnabled).toHaveBeenCalledWith(BOT_PROTECTION_FLAG);
    });

    it('setEnabled writes the flag and rebuilds the matcher immediately', async () => {
      featureFlags.isEnabled.mockResolvedValue(false);
      mockDb.__queue([]); // refresh -> listBlocklists
      mockDb.__queue([]); // refresh -> domain mappings
      await service.setEnabled(false);

      expect(featureFlags.setFlag).toHaveBeenCalledWith(BOT_PROTECTION_FLAG, false);
      expect(service.shouldBlock('/.env')).toBe(false);
    });
  });

  describe('library CRUD', () => {
    beforeEach(() => {
      // CRUD methods refresh() after mutating; isolate the queue bookkeeping
      // to the mutation itself. refresh() behaviour is covered above.
      jest.spyOn(service, 'refresh').mockResolvedValue(undefined);
    });

    it('creates a Blocklist, normalizing a missing leading slash on path patterns', async () => {
      mockDb.__queue([]); // name-uniqueness check
      mockDb.__queue([listRow()]); // insert().returning()
      // replaceEntries(block): delete, insert values
      // replaceEntries(allow): delete (no insert; allowlist empty)
      mockDb.__queue([]);
      mockDb.__queue([]);
      mockDb.__queue([]);
      mockDb.__queue([listRow()]); // getBlocklist: list
      mockDb.__queue([entryRow({ value: '/wp-extra' })]); // getBlocklist: entries
      mockDb.__queue([]); // getBlocklist: attachments

      const created = await service.createBlocklist({
        name: 'my-list',
        entries: [{ matchType: 'prefix', value: 'wp-extra' }],
        allowlist: [],
      });

      expect(created.entries).toEqual([{ matchType: 'prefix', value: '/wp-extra' }]);
      expect(mockDb.values).toHaveBeenCalledWith([
        expect.objectContaining({ kind: 'block', matchType: 'prefix', value: '/wp-extra' }),
      ]);
      expect(service.refresh).toHaveBeenCalled();
    });

    it('rejects invalid patterns with a per-pattern error list and writes nothing', async () => {
      await expect(
        service.createBlocklist({
          name: 'bad',
          entries: [
            { matchType: 'prefix', value: '/ok' },
            { matchType: 'prefix', value: '/bad;{}' },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('rejects a duplicate name', async () => {
      mockDb.__queue([listRow()]); // name-uniqueness check finds a clash
      await expect(service.createBlocklist({ name: 'my-list' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('update replaces entries only when provided', async () => {
      mockDb.__queue([listRow()]); // existence check
      // update(blocklists).set().where() is awaited
      mockDb.__queue([]);
      // replaceEntries(block): delete + insert
      mockDb.__queue([]);
      mockDb.__queue([]);
      mockDb.__queue([listRow()]); // getBlocklist: list
      mockDb.__queue([entryRow()]); // getBlocklist: entries
      mockDb.__queue([]); // getBlocklist: attachments

      const updated = await service.updateBlocklist('b1', {
        entries: [{ matchType: 'prefix', value: '/custom-probe' }],
      });

      expect(updated.entries).toEqual([{ matchType: 'prefix', value: '/custom-probe' }]);
      // Allowlist untouched: exactly one delete (the block-kind replacement).
      expect(mockDb.delete).toHaveBeenCalledTimes(1);
    });

    it('update of a missing Blocklist 404s', async () => {
      mockDb.__queue([]); // existence check
      await expect(service.updateBlocklist('nope', { name: 'x' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('delete of a missing Blocklist 404s', async () => {
      mockDb.__queue([]); // delete().returning() -> nothing deleted
      await expect(service.deleteBlocklist('nope')).rejects.toThrow(NotFoundException);
    });

    it('deduplicates repeated patterns case-insensitively', async () => {
      mockDb.__queue([]); // name-uniqueness check
      mockDb.__queue([listRow()]); // insert().returning()
      mockDb.__queue([]); // delete (block)
      mockDb.__queue([]); // insert values (block)
      mockDb.__queue([]); // delete (allow)
      mockDb.__queue([listRow()]); // getBlocklist: list
      mockDb.__queue([]); // getBlocklist: entries
      mockDb.__queue([]); // getBlocklist: attachments

      await service.createBlocklist({
        name: 'my-list',
        entries: [
          { matchType: 'prefix', value: '/Probe' },
          { matchType: 'prefix', value: '/probe' },
        ],
      });

      expect(mockDb.values).toHaveBeenCalledWith([
        expect.objectContaining({ value: '/Probe' }),
      ]);
    });
  });

  describe('per-domain enforcement (#393)', () => {
    const attachmentRow = (blocklistId: string, domainMappingId: string, domain: string) => ({
      blocklistId,
      domainMappingId,
      domain,
    });

    /** Refresh with one default list (b1), one attached-only list (b2 → dom-2). */
    const refreshWithAttachment = async (service: BlocklistService) => {
      mockDb.__queue([listRow(), listRow({ id: 'b2', name: 'scoped', isDefault: false })]);
      mockDb.__queue([
        entryRow(), // b1: /custom-probe (default list)
        entryRow({ id: 'e2', blocklistId: 'b2', value: '/scoped-probe' }),
        entryRow({
          id: 'e3',
          blocklistId: 'b2',
          kind: 'allow',
          matchType: 'exact',
          value: '/status',
        }),
      ]);
      mockDb.__queue([attachmentRow('b2', 'dom-2', 'attached.example.com')]);
      mockDb.__queue([
        { id: 'dom-1', domain: 'plain.example.com' },
        { id: 'dom-2', domain: 'attached.example.com' },
      ]);
      await service.refresh();
    };

    it('scopes an attached list to its domain; other hosts get the default set', async () => {
      await refreshWithAttachment(service);

      // Attached list applies only on its domain (and its www variant).
      expect(service.shouldBlock('/scoped-probe', 'attached.example.com')).toBe(true);
      expect(service.shouldBlock('/scoped-probe', 'www.attached.example.com')).toBe(true);
      expect(service.shouldBlock('/scoped-probe', 'ATTACHED.example.com:443')).toBe(true);
      expect(service.shouldBlock('/scoped-probe', 'plain.example.com')).toBe(false);
      expect(service.shouldBlock('/scoped-probe', 'unknown.example.com')).toBe(false);
      expect(service.shouldBlock('/scoped-probe')).toBe(false);

      // Default list + Baseline apply everywhere.
      expect(service.shouldBlock('/custom-probe', 'plain.example.com')).toBe(true);
      expect(service.shouldBlock('/.env', 'unknown.example.com')).toBe(true);

      // b2's allowlist rescues only where b2 applies.
      expect(service.shouldBlock('/status', 'attached.example.com')).toBe(false);
      expect(service.shouldBlock('/status', 'plain.example.com')).toBe(true); // Baseline /status block
    });

    it('exposes per-domain compiled state only for domains that differ from the default', async () => {
      await refreshWithAttachment(service);

      const domainStates = service.getCompiledDomainStates();
      expect([...domainStates.keys()]).toEqual(['dom-2']);
      expect(domainStates.get('dom-2')!.blockSource).toContain('/scoped-probe');

      expect(service.getCompiledStateForDomain('dom-2').blockSource).toContain('/scoped-probe');
      expect(service.getCompiledStateForDomain('dom-1').blockSource).not.toContain(
        '/scoped-probe',
      );
      expect(service.getCompiledStateForDomain('unknown').blockSource).not.toContain(
        '/scoped-probe',
      );
    });

    it('attaching an already-default list keeps the domain on the default matcher', async () => {
      mockDb.__queue([listRow()]); // b1, isDefault: true
      mockDb.__queue([entryRow()]);
      mockDb.__queue([attachmentRow('b1', 'dom-1', 'plain.example.com')]); // redundant attach
      mockDb.__queue([{ id: 'dom-1', domain: 'plain.example.com' }]);
      await service.refresh();

      expect(service.getCompiledDomainStates().size).toBe(0);
      expect(service.getCompiledStateForDomain('dom-1')).toEqual(service.getCompiledState());
    });

    it('fires change listeners when an attachment lands', async () => {
      const listener = jest.fn();
      service.onEffectiveChange(listener);

      mockDb.__queue([listRow({ id: 'b2', name: 'scoped', isDefault: false })]);
      mockDb.__queue([entryRow({ blocklistId: 'b2', value: '/scoped-probe' })]);
      mockDb.__queue([]); // no attachments yet
      mockDb.__queue([{ id: 'dom-2', domain: 'attached.example.com' }]);
      await service.refresh();
      expect(listener).not.toHaveBeenCalled(); // initial load

      mockDb.__queue([listRow({ id: 'b2', name: 'scoped', isDefault: false })]);
      mockDb.__queue([entryRow({ blocklistId: 'b2', value: '/scoped-probe' })]);
      mockDb.__queue([attachmentRow('b2', 'dom-2', 'attached.example.com')]);
      mockDb.__queue([{ id: 'dom-2', domain: 'attached.example.com' }]);
      await service.refresh();
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('domain attachment API (#393)', () => {
    beforeEach(() => {
      jest.spyOn(service, 'refresh').mockResolvedValue(undefined);
    });

    it('syncDomainBlocklists replaces the set (delete + insert) and refreshes', async () => {
      mockDb.__queue([{ id: 'dom-1' }]); // mapping existence check
      mockDb.__queue([{ id: 'b1' }, { id: 'b2' }]); // blocklist ids check
      mockDb.__queue([]); // tx delete
      mockDb.__queue([]); // tx insert

      const result = await service.syncDomainBlocklists('dom-1', ['b1', 'b2', 'b1']);

      expect(result).toEqual({ domainMappingId: 'dom-1', blocklistIds: ['b1', 'b2'] });
      expect(mockDb.delete).toHaveBeenCalledTimes(1);
      expect(mockDb.values).toHaveBeenCalledWith([
        { domainMappingId: 'dom-1', blocklistId: 'b1' },
        { domainMappingId: 'dom-1', blocklistId: 'b2' },
      ]);
      expect(service.refresh).toHaveBeenCalled();
    });

    it('detaching everything skips the insert', async () => {
      mockDb.__queue([{ id: 'dom-1' }]); // mapping existence check
      mockDb.__queue([]); // tx delete

      const result = await service.syncDomainBlocklists('dom-1', []);
      expect(result.blocklistIds).toEqual([]);
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('404s on an unknown domain mapping', async () => {
      mockDb.__queue([]); // mapping existence check
      await expect(service.syncDomainBlocklists('nope', [])).rejects.toThrow(NotFoundException);
    });

    it('400s on unknown blocklist ids, naming them', async () => {
      mockDb.__queue([{ id: 'dom-1' }]);
      mockDb.__queue([{ id: 'b1' }]); // only b1 exists
      await expect(service.syncDomainBlocklists('dom-1', ['b1', 'b2'])).rejects.toThrow(
        BadRequestException,
      );
      expect(mockDb.delete).not.toHaveBeenCalled();
    });

    it('getDomainBlocklistIds returns the attached ids', async () => {
      mockDb.__queue([{ blocklistId: 'b1' }, { blocklistId: 'b2' }]);
      await expect(service.getDomainBlocklistIds('dom-1')).resolves.toEqual(['b1', 'b2']);
    });
  });

  describe('appendEntry (inline add-to-blocklist, #393)', () => {
    beforeEach(() => {
      jest.spyOn(service, 'refresh').mockResolvedValue(undefined);
    });

    it('appends a normalized block pattern idempotently and refreshes', async () => {
      mockDb.__queue([listRow()]); // existence check
      mockDb.__queue([]); // insert … onConflictDoNothing
      mockDb.__queue([]); // touch updatedAt
      mockDb.__queue([listRow()]); // getBlocklist: list
      mockDb.__queue([entryRow({ value: '/wp-extra' })]); // getBlocklist: entries
      mockDb.__queue([]); // getBlocklist: attachments

      const result = await service.appendEntry('b1', { matchType: 'prefix', value: 'wp-extra' });

      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'block', matchType: 'prefix', value: '/wp-extra' }),
      );
      expect(mockDb.onConflictDoNothing).toHaveBeenCalled();
      expect(result.entries).toEqual([{ matchType: 'prefix', value: '/wp-extra' }]);
      expect(service.refresh).toHaveBeenCalled();
    });

    it('404s on an unknown Blocklist', async () => {
      mockDb.__queue([]); // existence check
      await expect(
        service.appendEntry('nope', { matchType: 'prefix', value: '/x' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects an invalid pattern without writing', async () => {
      mockDb.__queue([listRow()]); // existence check
      await expect(
        service.appendEntry('b1', { matchType: 'prefix', value: '/bad;{}' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockDb.insert).not.toHaveBeenCalled();
    });
  });
});
