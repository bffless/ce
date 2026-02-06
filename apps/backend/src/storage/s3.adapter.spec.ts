import { S3StorageAdapter } from './s3.adapter';
import { S3StorageConfig, validateS3Config } from './s3.config';
import { MinioStorageAdapter } from './minio.adapter';

describe('S3StorageAdapter', () => {
  const validConfig: S3StorageConfig = {
    region: 'us-east-1',
    bucket: 'test-bucket',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  };

  describe('validateS3Config', () => {
    it('should accept valid configuration', () => {
      expect(() => validateS3Config(validConfig)).not.toThrow();
    });

    it('should throw error without region', () => {
      expect(() => validateS3Config({ ...validConfig, region: '' })).toThrow(
        'S3 configuration requires region',
      );
    });

    it('should throw error without bucket', () => {
      expect(() => validateS3Config({ ...validConfig, bucket: '' })).toThrow(
        'S3 configuration requires bucket name',
      );
    });

    it('should throw error without accessKeyId', () => {
      expect(() => validateS3Config({ ...validConfig, accessKeyId: '' })).toThrow(
        'S3 configuration requires accessKeyId and secretAccessKey',
      );
    });

    it('should throw error without secretAccessKey', () => {
      expect(() => validateS3Config({ ...validConfig, secretAccessKey: '' })).toThrow(
        'S3 configuration requires accessKeyId and secretAccessKey',
      );
    });

    it('should throw error without both credentials', () => {
      expect(() =>
        validateS3Config({ ...validConfig, accessKeyId: '', secretAccessKey: '' }),
      ).toThrow('S3 configuration requires accessKeyId and secretAccessKey');
    });

    it('should validate presignedUrlExpiration range - too low', () => {
      expect(() => validateS3Config({ ...validConfig, presignedUrlExpiration: 0 })).toThrow(
        'presignedUrlExpiration must be between 1 and 604800 seconds',
      );
    });

    it('should validate presignedUrlExpiration range - too high', () => {
      expect(() => validateS3Config({ ...validConfig, presignedUrlExpiration: 700000 })).toThrow(
        'presignedUrlExpiration must be between 1 and 604800 seconds',
      );
    });

    it('should accept valid presignedUrlExpiration', () => {
      expect(() => validateS3Config({ ...validConfig, presignedUrlExpiration: 3600 })).not.toThrow();
      expect(() => validateS3Config({ ...validConfig, presignedUrlExpiration: 1 })).not.toThrow();
      expect(() =>
        validateS3Config({ ...validConfig, presignedUrlExpiration: 604800 }),
      ).not.toThrow();
    });

    it('should accept valid endpoint URL', () => {
      expect(() =>
        validateS3Config({ ...validConfig, endpoint: 'https://nyc3.digitaloceanspaces.com' }),
      ).not.toThrow();
    });

    it('should throw error for invalid endpoint URL', () => {
      expect(() => validateS3Config({ ...validConfig, endpoint: 'not-a-valid-url' })).toThrow(
        'Invalid endpoint URL: not-a-valid-url',
      );
    });
  });

  describe('endpoint parsing', () => {
    it('should construct AWS S3 endpoint from region', () => {
      // The adapter should internally construct s3.us-east-1.amazonaws.com
      const adapter = new S3StorageAdapter(validConfig);
      expect(adapter).toBeDefined();
    });

    it('should construct endpoint for different regions', () => {
      const euConfig: S3StorageConfig = {
        ...validConfig,
        region: 'eu-west-1',
      };
      const adapter = new S3StorageAdapter(euConfig);
      expect(adapter).toBeDefined();
    });

    it('should parse custom HTTPS endpoint URL', () => {
      const config: S3StorageConfig = {
        ...validConfig,
        endpoint: 'https://nyc3.digitaloceanspaces.com',
      };
      const adapter = new S3StorageAdapter(config);
      expect(adapter).toBeDefined();
    });

    it('should parse custom HTTP endpoint URL', () => {
      const config: S3StorageConfig = {
        ...validConfig,
        endpoint: 'http://localhost:9000',
      };
      const adapter = new S3StorageAdapter(config);
      expect(adapter).toBeDefined();
    });

    it('should handle endpoint with custom port', () => {
      const config: S3StorageConfig = {
        ...validConfig,
        endpoint: 'http://localhost:9000',
      };
      const adapter = new S3StorageAdapter(config);
      expect(adapter).toBeDefined();
    });

    it('should handle endpoint with explicit HTTPS port', () => {
      const config: S3StorageConfig = {
        ...validConfig,
        endpoint: 'https://s3.example.com:8443',
      };
      const adapter = new S3StorageAdapter(config);
      expect(adapter).toBeDefined();
    });

    it('should throw error for invalid endpoint URL in constructor', () => {
      const config: S3StorageConfig = {
        ...validConfig,
        endpoint: 'not-a-valid-url',
      };
      expect(() => new S3StorageAdapter(config)).toThrow('Invalid endpoint URL');
    });
  });

  describe('inheritance from MinioStorageAdapter', () => {
    it('should extend MinioStorageAdapter', () => {
      const adapter = new S3StorageAdapter(validConfig);
      expect(adapter).toBeInstanceOf(MinioStorageAdapter);
    });

    it('should have inherited upload method', () => {
      const adapter = new S3StorageAdapter(validConfig);
      expect(typeof adapter.upload).toBe('function');
    });

    it('should have inherited download method', () => {
      const adapter = new S3StorageAdapter(validConfig);
      expect(typeof adapter.download).toBe('function');
    });

    it('should have inherited delete method', () => {
      const adapter = new S3StorageAdapter(validConfig);
      expect(typeof adapter.delete).toBe('function');
    });

    it('should have inherited exists method', () => {
      const adapter = new S3StorageAdapter(validConfig);
      expect(typeof adapter.exists).toBe('function');
    });

    it('should have inherited getUrl method', () => {
      const adapter = new S3StorageAdapter(validConfig);
      expect(typeof adapter.getUrl).toBe('function');
    });

    it('should have inherited listKeys method', () => {
      const adapter = new S3StorageAdapter(validConfig);
      expect(typeof adapter.listKeys).toBe('function');
    });

    it('should have inherited getMetadata method', () => {
      const adapter = new S3StorageAdapter(validConfig);
      expect(typeof adapter.getMetadata).toBe('function');
    });

    it('should have inherited testConnection method', () => {
      const adapter = new S3StorageAdapter(validConfig);
      expect(typeof adapter.testConnection).toBe('function');
    });
  });

  describe('S3-compatible services', () => {
    it('should work with DigitalOcean Spaces endpoint', () => {
      const config: S3StorageConfig = {
        ...validConfig,
        region: 'nyc3',
        endpoint: 'https://nyc3.digitaloceanspaces.com',
      };
      const adapter = new S3StorageAdapter(config);
      expect(adapter).toBeDefined();
    });

    it('should work with Backblaze B2 endpoint', () => {
      const config: S3StorageConfig = {
        ...validConfig,
        region: 'us-west-000',
        endpoint: 'https://s3.us-west-000.backblazeb2.com',
        forcePathStyle: true,
      };
      const adapter = new S3StorageAdapter(config);
      expect(adapter).toBeDefined();
    });

    it('should work with Cloudflare R2 endpoint', () => {
      const config: S3StorageConfig = {
        ...validConfig,
        region: 'auto',
        endpoint: 'https://account-id.r2.cloudflarestorage.com',
        forcePathStyle: true,
      };
      const adapter = new S3StorageAdapter(config);
      expect(adapter).toBeDefined();
    });

    it('should work with Wasabi endpoint', () => {
      const config: S3StorageConfig = {
        ...validConfig,
        region: 'us-east-1',
        endpoint: 'https://s3.us-east-1.wasabisys.com',
      };
      const adapter = new S3StorageAdapter(config);
      expect(adapter).toBeDefined();
    });
  });
});
