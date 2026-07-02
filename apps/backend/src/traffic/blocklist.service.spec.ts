import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

// Mock the db client with a thenable chainable: every builder method returns
// the chain, and awaiting the chain consumes the next queued result (in the
// order the service awaits its queries). Mirrors request-log.service.spec.
jest.mock('../db/client', () => {
  const queued: unknown[] = [];
  const methods = [
    'select',
    'from',
    'where',
    'orderBy',
    'limit',
    'insert',
    'values',
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
      await service.refresh();

      expect(service.shouldBlock('/custom-probe/x')).toBe(true); // list pattern
      expect(service.shouldBlock('/.env')).toBe(true); // Baseline
      expect(service.shouldBlock('/status')).toBe(false); // allowlist rescues a Baseline block
      expect(service.shouldBlock('/index.html')).toBe(false);
    });

    it('blocks nothing when the master toggle is off', async () => {
      featureFlags.isEnabled.mockResolvedValue(false);
      mockDb.__queue([]); // listBlocklists: no lists
      await service.refresh();

      expect(service.shouldBlock('/wp-login.php')).toBe(false);
      expect(service.shouldBlock('/.env')).toBe(false);
    });

    it('keeps the last good matcher when a refresh fails', async () => {
      mockDb.__queue([]); // successful refresh: Baseline only, enabled
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
});
