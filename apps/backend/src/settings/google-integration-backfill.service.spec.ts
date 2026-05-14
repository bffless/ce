import { Test, TestingModule } from '@nestjs/testing';

jest.mock('../db/client', () => ({
  db: {
    select: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { db } = require('../db/client');

import { GoogleIntegrationBackfillService } from './google-integration-backfill.service';
import { encryptJson, __resetKeyForTests } from '../common/crypto/aes-gcm';

const TEST_KEY = Buffer.alloc(32, 7).toString('base64');

describe('GoogleIntegrationBackfillService', () => {
  let service: GoogleIntegrationBackfillService;
  let originalKey: string | undefined;

  // Wire up a fresh chain of db method mocks per test so calls don't bleed.
  function mockSelectFromWhere(rows: any[]) {
    db.select.mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue(rows),
      }),
    });
  }

  function mockInsertOnConflict(inserted: any[]) {
    const returning = jest.fn().mockResolvedValue(inserted);
    db.insert.mockReturnValue({
      values: jest.fn().mockReturnValue({
        onConflictDoNothing: jest.fn().mockReturnValue({ returning }),
      }),
    });
    return returning;
  }

  function mockUpdateSetWhere() {
    const where = jest.fn().mockResolvedValue(undefined);
    db.update.mockReturnValue({
      set: jest.fn().mockReturnValue({ where }),
    });
    return where;
  }

  beforeEach(async () => {
    originalKey = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = TEST_KEY;
    __resetKeyForTests();
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [GoogleIntegrationBackfillService],
    }).compile();
    service = module.get(GoogleIntegrationBackfillService);
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalKey;
    __resetKeyForTests();
  });

  it('is a no-op when no legacy system_config rows are populated', async () => {
    mockSelectFromWhere([]);
    const result = await service.runBackfill();
    expect(result).toEqual({ migrated: 0, skipped: 0, alreadyPresent: 0 });
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('migrates one legacy row into the new table and NULLs the legacy column', async () => {
    const legacyBlob = encryptJson({ clientId: 'legacy-cid', clientSecret: 'legacy-sec' });
    mockSelectFromWhere([{ id: 'sc-1', googleOauthConfig: legacyBlob }]);
    const returning = mockInsertOnConflict([{ id: 'new-row-1' }]);
    const updateWhere = mockUpdateSetWhere();

    const result = await service.runBackfill();

    expect(result).toEqual({ migrated: 1, skipped: 0, alreadyPresent: 0 });
    expect(returning).toHaveBeenCalled();
    // The legacy row was cleared
    expect(db.update).toHaveBeenCalled();
    expect(updateWhere).toHaveBeenCalled();
  });

  it('counts a row as alreadyPresent when the new table already has it (onConflictDoNothing returns empty)', async () => {
    const legacyBlob = encryptJson({ clientId: 'legacy-cid', clientSecret: 'legacy-sec' });
    mockSelectFromWhere([{ id: 'sc-1', googleOauthConfig: legacyBlob }]);
    mockInsertOnConflict([]); // unique-index conflict → no rows returned
    mockUpdateSetWhere();

    const result = await service.runBackfill();

    expect(result).toEqual({ migrated: 0, skipped: 0, alreadyPresent: 1 });
    // Legacy column is still NULLed even when the new table already had it —
    // the new table is authoritative either way.
    expect(db.update).toHaveBeenCalled();
  });

  it('skips rows that fail to decrypt without throwing', async () => {
    mockSelectFromWhere([{ id: 'sc-1', googleOauthConfig: 'not-a-real-cipher' }]);
    mockUpdateSetWhere();
    // No insert should be called when decryption fails
    db.insert.mockImplementation(() => {
      throw new Error('insert should not be called when decryption fails');
    });

    const result = await service.runBackfill();
    expect(result).toEqual({ migrated: 0, skipped: 1, alreadyPresent: 0 });
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled(); // no NULL-out on skip
  });

  it('skips rows where decrypted JSON is missing required fields', async () => {
    const incompleteBlob = encryptJson({ clientId: 'only-id' }); // no clientSecret
    mockSelectFromWhere([{ id: 'sc-1', googleOauthConfig: incompleteBlob }]);
    mockUpdateSetWhere();

    const result = await service.runBackfill();
    expect(result).toEqual({ migrated: 0, skipped: 1, alreadyPresent: 0 });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('is idempotent: second run finds nothing to do', async () => {
    // First run: 1 row migrated.
    const legacyBlob = encryptJson({ clientId: 'cid', clientSecret: 'sec' });
    mockSelectFromWhere([{ id: 'sc-1', googleOauthConfig: legacyBlob }]);
    mockInsertOnConflict([{ id: 'new-1' }]);
    mockUpdateSetWhere();
    expect(await service.runBackfill()).toEqual({ migrated: 1, skipped: 0, alreadyPresent: 0 });

    // Second run: the WHERE clause (configured=true AND config IS NOT NULL)
    // now excludes the row, since the previous run NULLed it. Simulate by
    // returning no rows.
    jest.clearAllMocks();
    mockSelectFromWhere([]);
    expect(await service.runBackfill()).toEqual({ migrated: 0, skipped: 0, alreadyPresent: 0 });
  });

  it('onModuleInit swallows backfill errors so backend boot is non-fatal', async () => {
    db.select.mockImplementation(() => {
      throw new Error('boom — database not ready');
    });
    await expect(service.onModuleInit()).resolves.toBeUndefined();
  });
});
