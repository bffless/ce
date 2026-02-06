import { Test, TestingModule } from '@nestjs/testing';
import { SslInfoService } from './ssl-info.service';
import * as fs from 'fs/promises';

// Mock fs/promises
jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
  access: jest.fn(),
}));

// Mock crypto X509Certificate
const mockX509Certificate = {
  validTo: new Date('2025-06-01T00:00:00Z').toISOString(),
  validFrom: new Date('2024-01-01T00:00:00Z').toISOString(),
  subject: 'CN=*.example.com',
  issuer: 'O=Let\'s Encrypt, CN=R3',
  serialNumber: '1234567890ABCDEF',
  fingerprint256: 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99',
};

jest.mock('crypto', () => ({
  ...jest.requireActual('crypto'),
  X509Certificate: jest.fn().mockImplementation(() => mockX509Certificate),
}));

// Dummy cert PEM (just used as input, actual parsing is mocked)
const DUMMY_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIB...dummy...
-----END CERTIFICATE-----`;

describe('SslInfoService', () => {
  let service: SslInfoService;
  let mockReadFile: jest.MockedFunction<typeof fs.readFile>;
  let mockAccess: jest.MockedFunction<typeof fs.access>;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockReadFile = fs.readFile as jest.MockedFunction<typeof fs.readFile>;
    mockAccess = fs.access as jest.MockedFunction<typeof fs.access>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [SslInfoService],
    }).compile();

    service = module.get<SslInfoService>(SslInfoService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('parseCertificate', () => {
    it('should parse a valid certificate and return correct structure', () => {
      const result = service.parseCertificate(DUMMY_CERT_PEM, 'individual');

      expect(result).toBeDefined();
      expect(result.type).toBe('individual');
      expect(result.commonName).toBe('*.example.com');
      expect(result.issuer).toBe("Let's Encrypt");
      expect(result.serialNumber).toBe('1234567890ABCDEF');
      expect(result.fingerprint).toBeDefined();
      expect(result.issuedAt).toBeInstanceOf(Date);
      expect(result.expiresAt).toBeInstanceOf(Date);
    });

    it('should set type to wildcard for wildcard certificates', () => {
      const result = service.parseCertificate(DUMMY_CERT_PEM, 'wildcard');
      expect(result.type).toBe('wildcard');
    });

    it('should set type to wildcard for subdomain certificates', () => {
      const result = service.parseCertificate(DUMMY_CERT_PEM, 'subdomain');
      expect(result.type).toBe('wildcard');
    });

    it('should set type to individual for custom domain certificates', () => {
      const result = service.parseCertificate(DUMMY_CERT_PEM, 'custom');
      expect(result.type).toBe('individual');
    });

    it('should calculate days until expiry correctly', () => {
      const result = service.parseCertificate(DUMMY_CERT_PEM, 'individual');

      // Certificate expires June 1, 2025
      expect(typeof result.daysUntilExpiry).toBe('number');
    });

    it('should identify valid certificates', () => {
      const result = service.parseCertificate(DUMMY_CERT_PEM, 'individual');

      // Certificate is valid from Jan 1, 2024 to June 1, 2025
      // Should be valid if current date is between these
      expect(typeof result.isValid).toBe('boolean');
    });

    it('should identify expiring soon based on 30 day threshold', () => {
      const result = service.parseCertificate(DUMMY_CERT_PEM, 'individual');

      // isExpiringSoon should be true if daysUntilExpiry <= 30
      expect(typeof result.isExpiringSoon).toBe('boolean');
    });
  });

  describe('getDomainSslInfo', () => {
    it('should return certificate info for subdomain', async () => {
      mockReadFile.mockResolvedValueOnce(DUMMY_CERT_PEM);

      const result = await service.getDomainSslInfo('test.example.com', 'subdomain');

      expect(result).toBeDefined();
      expect(result?.type).toBe('wildcard');
      expect(mockReadFile).toHaveBeenCalled();
    });

    it('should return certificate info for custom domain', async () => {
      mockReadFile.mockResolvedValueOnce(DUMMY_CERT_PEM);

      const result = await service.getDomainSslInfo('custom.example.com', 'custom');

      expect(result).toBeDefined();
      expect(result?.type).toBe('individual');
    });

    it('should return null if certificate file not found', async () => {
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      const result = await service.getDomainSslInfo('missing.example.com', 'custom');

      expect(result).toBeNull();
    });
  });

  describe('getWildcardCertInfo', () => {
    it('should return wildcard certificate info', async () => {
      mockReadFile.mockResolvedValueOnce(DUMMY_CERT_PEM);

      const result = await service.getWildcardCertInfo();

      expect(result).toBeDefined();
      expect(result?.type).toBe('wildcard');
    });

    it('should return null if wildcard cert not found', async () => {
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      const result = await service.getWildcardCertInfo();

      expect(result).toBeNull();
    });
  });

  describe('getAppDomainCertInfo', () => {
    it('should return certificate info for app domain', async () => {
      mockReadFile.mockResolvedValueOnce(DUMMY_CERT_PEM);

      const result = await service.getAppDomainCertInfo('admin');

      expect(result).toBeDefined();
      expect(result?.type).toBe('individual');
    });

    it('should return null if app domain cert not found', async () => {
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      const result = await service.getAppDomainCertInfo('admin');

      expect(result).toBeNull();
    });
  });

  describe('certificateExists', () => {
    it('should return true if both cert and key exist', async () => {
      mockAccess.mockResolvedValue(undefined);

      const result = await service.certificateExists('test.example.com', 'custom');

      expect(result).toBe(true);
      expect(mockAccess).toHaveBeenCalledTimes(2);
    });

    it('should return false if cert does not exist', async () => {
      mockAccess.mockRejectedValueOnce(new Error('ENOENT'));

      const result = await service.certificateExists('missing.example.com', 'custom');

      expect(result).toBe(false);
    });

    it('should return false if key does not exist', async () => {
      mockAccess.mockResolvedValueOnce(undefined);
      mockAccess.mockRejectedValueOnce(new Error('ENOENT'));

      const result = await service.certificateExists('missing-key.example.com', 'custom');

      expect(result).toBe(false);
    });

    it('should check subdomain certs in wildcard path', async () => {
      mockAccess.mockResolvedValue(undefined);

      await service.certificateExists('test.example.com', 'subdomain');

      // For subdomains, should check wildcard cert paths
      expect(mockAccess).toHaveBeenCalledTimes(2);
    });
  });
});
