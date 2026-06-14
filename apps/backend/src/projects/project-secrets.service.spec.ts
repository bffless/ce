import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { ProjectSecretsService } from './project-secrets.service';

describe('ProjectSecretsService', () => {
  const buildService = () => {
    // Deterministic 32-byte key (base64) so encrypt/decrypt round-trips.
    const key = Buffer.alloc(32, 7).toString('base64');
    const configService = {
      get: jest.fn().mockReturnValue(key),
    } as unknown as ConfigService;
    return new ProjectSecretsService(configService);
  };

  describe('encryption round-trip (private helpers)', () => {
    it('decrypts what it encrypts', () => {
      const service = buildService() as unknown as {
        encryptData: (s: string) => string;
        decryptData: (s: string) => string;
      };
      const enc = service.encryptData('hf_supersecret_value');
      expect(enc).not.toContain('hf_supersecret_value');
      expect(service.decryptData(enc)).toBe('hf_supersecret_value');
    });

    it('produces a different ciphertext each time (random IV)', () => {
      const service = buildService() as unknown as { encryptData: (s: string) => string };
      const a = service.encryptData('same-value');
      const b = service.encryptData('same-value');
      expect(a).not.toBe(b);
    });
  });

  describe('setSecret validation (rejects before any DB write)', () => {
    it.each([
      ['lowercase', 'hf_token'],
      ['starts with digit', '1TOKEN'],
      ['has dash', 'HF-TOKEN'],
      ['empty', ''],
    ])('rejects invalid name: %s', async (_label, name) => {
      const service = buildService();
      await expect(service.setSecret('p1', name, 'value')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects an empty value', async () => {
      const service = buildService();
      await expect(service.setSecret('p1', 'HF_TOKEN', '')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('accepts a valid uppercase/underscore/digit name', async () => {
      const service = buildService();
      // Valid name passes validation; the DB call then throws (no real DB in
      // unit test), which proves we got past validation.
      await expect(service.setSecret('p1', 'HF_TOKEN_2', 'value')).rejects.not.toBeInstanceOf(
        BadRequestException,
      );
    });
  });
});
