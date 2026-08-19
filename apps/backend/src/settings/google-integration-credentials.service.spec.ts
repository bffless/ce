import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';

// Mock the database module BEFORE importing the service.
jest.mock('../db/client', () => ({
  db: {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { db } = require('../db/client');

import { GoogleIntegrationCredentialsService } from './google-integration-credentials.service';
import { encryptJson, __resetKeyForTests } from '../common/crypto/aes-gcm';

const TEST_KEY = Buffer.alloc(32, 7).toString('base64');

describe('GoogleIntegrationCredentialsService', () => {
  let service: GoogleIntegrationCredentialsService;
  let originalKey: string | undefined;

  beforeEach(async () => {
    originalKey = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = TEST_KEY;
    __resetKeyForTests();
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [GoogleIntegrationCredentialsService],
    }).compile();
    service = module.get(GoogleIntegrationCredentialsService);
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalKey;
    __resetKeyForTests();
  });

  /** Helper to make db.select()...limit() resolve to the given rows. */
  const mockSelect = (rows: any[]) => {
    db.select.mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue(rows),
        }),
      }),
    });
  };

  describe('getStatus', () => {
    it('returns isConfigured=false when no row exists', async () => {
      mockSelect([]);
      const status = await service.getStatus('calendar');
      expect(status).toEqual({ service: 'calendar', isConfigured: false });
    });

    it('returns masked clientId when row exists', async () => {
      const blob = encryptJson({
        clientId: 'cid-12345-67890.apps.googleusercontent.com',
        clientSecret: 'sec',
      });
      mockSelect([{ id: 'row-1', configEncrypted: blob, configured: true }]);

      const status = await service.getStatus('calendar');
      expect(status.isConfigured).toBe(true);
      expect(status.service).toBe('calendar');
      expect(status.hasSecret).toBe(true);
      // Masking takes first 6 + last 4
      expect(status.clientIdMasked).toContain('...');
      expect(status.clientIdMasked).not.toContain('67890.apps');
    });

    it('returns isConfigured=false when decryption fails', async () => {
      mockSelect([{ id: 'row-1', configEncrypted: 'not-a-valid-cipher', configured: true }]);
      const status = await service.getStatus('calendar');
      expect(status).toEqual({ service: 'calendar', isConfigured: false });
    });
  });

  describe('getCredentials', () => {
    it('returns null when not configured', async () => {
      mockSelect([]);
      expect(await service.getCredentials('calendar')).toBeNull();
    });

    it('returns decoded credentials including scopes override', async () => {
      const blob = encryptJson({
        clientId: 'cid',
        clientSecret: 'sec',
        scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
      });
      mockSelect([{ id: 'row-1', configEncrypted: blob, configured: true }]);

      const creds = await service.getCredentials('calendar');
      expect(creds).toEqual({
        clientId: 'cid',
        clientSecret: 'sec',
        scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
      });
    });
  });

  describe('update', () => {
    it('rejects empty clientId or clientSecret', async () => {
      await expect(
        service.update('calendar', { clientId: '', clientSecret: 'sec' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.update('calendar', { clientId: 'cid', clientSecret: '   ' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('inserts when no row exists', async () => {
      mockSelect([]); // first findRow → empty
      const insertValues = jest.fn().mockResolvedValue(undefined);
      db.insert.mockReturnValue({ values: insertValues });

      await service.update('calendar', { clientId: 'cid', clientSecret: 'sec' }, 'user-1');

      expect(db.insert).toHaveBeenCalled();
      const valuesArg = insertValues.mock.calls[0][0];
      expect(valuesArg.service).toBe('calendar');
      expect(valuesArg.configured).toBe(true);
      expect(valuesArg.createdByUserId).toBe('user-1');
      expect(typeof valuesArg.configEncrypted).toBe('string');
      expect(valuesArg.configEncrypted.split(':')).toHaveLength(3);
    });

    it('updates when row exists', async () => {
      mockSelect([{ id: 'row-1', configEncrypted: 'stale', configured: true }]);
      const updateWhere = jest.fn().mockResolvedValue(undefined);
      const updateSet = jest.fn().mockReturnValue({ where: updateWhere });
      db.update.mockReturnValue({ set: updateSet });

      await service.update('calendar', { clientId: 'cid', clientSecret: 'sec' });

      expect(db.update).toHaveBeenCalled();
      const setArg = updateSet.mock.calls[0][0];
      expect(setArg.configured).toBe(true);
      expect(typeof setArg.configEncrypted).toBe('string');
    });
  });

  describe('clear', () => {
    it('throws NotFound when no row exists', async () => {
      mockSelect([]);
      await expect(service.clear('calendar')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('deletes the row when present', async () => {
      mockSelect([
        {
          id: 'row-1',
          configEncrypted: encryptJson({ clientId: 'c', clientSecret: 's' }),
          configured: true,
        },
      ]);
      const deleteWhere = jest.fn().mockResolvedValue(undefined);
      db.delete.mockReturnValue({ where: deleteWhere });

      await service.clear('calendar');
      expect(db.delete).toHaveBeenCalled();
      expect(deleteWhere).toHaveBeenCalled();
    });
  });
});
