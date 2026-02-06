# Storage Adapters Module

## Overview

This module provides a flexible storage abstraction layer that supports multiple storage backends through a unified interface. This enables the platform to work with local filesystem, MinIO, S3, Google Cloud Storage, and Azure Blob Storage.

## Architecture

### Storage Interface (`storage.interface.ts`)

The `IStorageAdapter` interface defines the contract that all storage adapters must implement:

- **Core Operations:**
  - `upload(file, key, metadata)` - Upload a file
  - `download(key)` - Download a file
  - `delete(key)` - Delete a file
  - `exists(key)` - Check if a file exists
  - `getUrl(key, expiresIn?)` - Get a URL to access the file

- **Migration-Friendly Methods:**
  - `listKeys(prefix?)` - List all storage keys (required for migration)
  - `getMetadata(key)` - Get file metadata without downloading
  - `testConnection()` - Validate storage backend accessibility

### Storage Key Format

**GitHub-style format used across all storage types:**

```
{owner}/{repo}/{commitSha}/{path}/{filename}
```

**Examples:**

- `owner/repo/abc123def456/index.html`
- `owner/repo/abc123def456/css/style.css`
- `owner/repo/abc123def456/images/logo.png`

**Benefits:**

- Matches GitHub repository structure (intuitive)
- SHA provides immutability and uniqueness
- Preserves directory structure within deployment
- No leading/trailing slashes (works on local + object storage)
- URL-safe characters only
- Easy to migrate between storage backends
- Easy to find all files for a specific commit: `listKeys("owner/repo/abc123/")`

## Implemented Adapters

### 1. Local Storage Adapter (`local.adapter.ts`)

Stores files on the local filesystem.

**Configuration:**

```typescript
{
  localPath: './uploads',    // Base directory for file storage
  baseUrl: 'http://localhost:3000/files'  // Base URL for serving files
}
```

**Features:**

- Creates directories automatically
- Stores metadata as separate `.meta.json` files
- Removes empty directories on delete
- MIME type guessing from file extensions
- Path traversal protection

**Use Cases:**

- Development and testing
- Small deployments
- Single-server setups

### 2. MinIO Storage Adapter (`minio.adapter.ts`)

S3-compatible object storage adapter for MinIO.

**Configuration:**

```typescript
{
  endPoint: 'localhost',
  port: 9000,
  useSSL: false,
  accessKey: 'minioadmin',
  secretKey: 'minioadmin',
  bucket: 'assets',
  region: 'us-east-1'  // optional
}
```

**Features:**

- Automatic bucket creation
- Presigned URL generation
- S3-compatible API
- Streaming upload/download
- Metadata support

**Use Cases:**

- Production deployments
- Scalable storage
- Multi-server setups
- Can also work with AWS S3 (S3-compatible)

## Storage Module (`storage.module.ts`)

Dynamic module that provides the appropriate storage adapter based on configuration.

### Usage

#### Option 1: Static Configuration

```typescript
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    StorageModule.forRoot({
      storageType: 'local',
      config: { localPath: './uploads' },
    }),
  ],
})
export class AppModule {}
```

#### Option 2: Async Configuration (Recommended)

```typescript
import { StorageModule } from './storage/storage.module';
import { SetupService } from './setup/setup.service';

@Module({
  imports: [
    StorageModule.forRootAsync({
      imports: [SetupModule],
      inject: [SetupService],
      useFactory: async (setupService: SetupService) => {
        const config = await setupService.getSystemConfig();
        return {
          storageType: config.storageProvider,
          config: await setupService.getStorageConfig(),
        };
      },
    }),
  ],
})
export class AssetsModule {}
```

#### Option 3: Inject in Services

```typescript
import { Inject } from '@nestjs/common';
import { STORAGE_ADAPTER } from './storage/storage.module';
import { IStorageAdapter } from './storage/storage.interface';

@Injectable()
export class AssetsService {
  constructor(@Inject(STORAGE_ADAPTER) private storage: IStorageAdapter) {}

  async uploadFile(file: Buffer, key: string) {
    return await this.storage.upload(file, key);
  }
}
```

## Integration with Setup Module

The setup module now includes actual storage testing:

```typescript
// Test storage connection during setup
const result = await setupService.testStorageConnection();
// Returns: { success: boolean, message: string, error?: string }
```

When storage is configured via the setup wizard, the system:

1. Validates the configuration structure
2. Encrypts sensitive credentials (access keys, secrets)
3. Stores encrypted config in the database
4. Tests the connection by creating a temporary test file
5. Returns success/failure status

## File Operations Examples

### Upload

```typescript
const key = 'owner/repo/abc123def456/index.html';
const fileBuffer = Buffer.from('<html>...</html>');
const metadata = { mimeType: 'text/html' };

const storageKey = await storage.upload(fileBuffer, key, metadata);
// Returns: 'owner/repo/abc123def456/index.html'
```

### Download

```typescript
const fileBuffer = await storage.download('owner/repo/abc123def456/index.html');
// Returns: Buffer
```

### Get URL

```typescript
// Local storage: returns backend API URL
const url = await localAdapter.getUrl('owner/repo/abc123def456/index.html');
// Returns: 'http://localhost:3000/files/owner/repo/abc123def456/index.html'

// MinIO: returns presigned URL
const url = await minioAdapter.getUrl('owner/repo/abc123def456/index.html', 3600);
// Returns: 'https://minio.example.com/bucket/owner/repo/abc123def456/index.html?X-Amz-...'
```

### List Keys (For Migration)

```typescript
// List all files for a specific commit
const keys = await storage.listKeys('owner/repo/abc123def456');
// Returns: [
//   'owner/repo/abc123def456/index.html',
//   'owner/repo/abc123def456/style.css',
//   'owner/repo/abc123def456/images/logo.png'
// ]
```

### Get Metadata

```typescript
const metadata = await storage.getMetadata('owner/repo/abc123def456/index.html');
// Returns: {
//   key: 'owner/repo/abc123def456/index.html',
//   size: 1024,
//   mimeType: 'text/html',
//   lastModified: Date,
//   etag: 'abc123...'
// }
```

## Security Features

### Path Traversal Protection

All adapters sanitize keys to prevent path traversal attacks:

```typescript
// These will throw errors:
await storage.upload(file, '../../../etc/passwd'); // ❌ Path traversal
await storage.upload(file, 'owner/repo/../other'); // ❌ Path traversal
await storage.upload(file, 'owner/repo/<script>'); // ❌ Unsafe characters
```

### Encrypted Configuration Storage

Sensitive storage credentials are encrypted before being stored in the database:

- Uses AES-256-GCM encryption
- Unique IV for each encryption
- Authentication tag for integrity verification
- Encryption key stored in environment variable

## Testing

### Unit Tests

Unit tests are provided for both adapters:

- `local.adapter.spec.ts` - Local storage adapter tests
- `minio.adapter.spec.ts` - MinIO adapter tests (uses mocks)

**Run tests:**

```bash
cd apps/backend
pnpm test storage
```

### Manual Testing

#### Test Local Storage

```bash
# Start backend
cd apps/backend
pnpm dev

# Configure local storage via API
curl -X POST http://localhost:3000/api/setup/storage \
  -H "Content-Type: application/json" \
  -d '{
    "storageProvider": "local",
    "config": {
      "localPath": "./uploads",
      "baseUrl": "http://localhost:3000/files"
    }
  }'

# Test connection
curl http://localhost:3000/api/setup/test-storage
```

#### Test MinIO Storage

```bash
# Start MinIO via Docker
docker-compose -f docker-compose.dev.yml up -d minio

# Configure MinIO storage via API
curl -X POST http://localhost:3000/api/setup/storage \
  -H "Content-Type: application/json" \
  -d '{
    "storageProvider": "minio",
    "config": {
      "endpoint": "localhost",
      "port": 9000,
      "useSSL": false,
      "accessKey": "minioadmin",
      "secretKey": "minioadmin",
      "bucket": "assets"
    }
  }'

# change "endpoint" to minio for production or when run inside of docker
# Test connection
curl http://localhost:3000/api/setup/test-storage
```

## Future Adapters

### AWS S3 Adapter (To Be Implemented)

```typescript
{
  region: 'us-east-1',
  accessKeyId: 'AKIA...',
  secretAccessKey: '...',
  bucket: 'my-bucket'
}
```

### Google Cloud Storage Adapter (To Be Implemented)

```typescript
{
  projectId: 'my-project',
  bucket: 'my-bucket',
  keyFile: '/path/to/service-account.json'
}
```

### Azure Blob Storage Adapter (To Be Implemented)

```typescript
{
  accountName: 'myaccount',
  accountKey: '...',
  containerName: 'assets'
}
```

## Migration Support

The storage interface is designed to support future storage migration:

1. **List all keys** - `listKeys()` can enumerate all files
2. **Get metadata** - `getMetadata()` provides size/type without downloading
3. **Consistent key format** - Same keys work across all adapters
4. **Copy files** - Download from source, upload to destination

Example migration flow:

```typescript
// Pseudocode for future migration feature
const sourceAdapter = new LocalStorageAdapter(sourceConfig);
const destAdapter = new MinioStorageAdapter(destConfig);

const keys = await sourceAdapter.listKeys();
for (const key of keys) {
  const file = await sourceAdapter.download(key);
  const metadata = await sourceAdapter.getMetadata(key);
  await destAdapter.upload(file, key, metadata);
}
```

## Deployment

### Production Considerations

1. **Local Storage:**
   - Use only for development or small single-server deployments
   - Requires persistent volume in Docker/Kubernetes
   - Not recommended for multi-server setups

2. **MinIO:**
   - Recommended for production deployments
   - Can run in distributed mode for high availability
   - S3-compatible, easy to migrate to AWS S3 later

3. **Cloud Storage (S3/GCS/Azure):**
   - Best for large-scale production
   - Managed service, no infrastructure overhead
   - Pay only for what you use

### Docker Configuration

For production deployments with MinIO:

```yaml
# docker-compose.yml
services:
  backend:
    environment:
      - STORAGE_PROVIDER=minio
      - MINIO_ENDPOINT=minio
      - MINIO_PORT=9000
      - MINIO_ACCESS_KEY=minioadmin
      - MINIO_SECRET_KEY=minioadmin
      - MINIO_BUCKET=assets

  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    volumes:
      - minio-data:/data
    ports:
      - '9000:9000'
      - '9001:9001'

volumes:
  minio-data:
```

### Production Cloud Deployment

#### Option 1: Managed Object Storage (Recommended)

Use your cloud provider's S3-compatible object storage - no infrastructure to manage.

**Digital Ocean Spaces:**

```bash
# Setup configuration
MINIO_ENDPOINT="nyc3.digitaloceanspaces.com"
MINIO_ACCESS_KEY="your-spaces-key"
MINIO_SECRET_KEY="your-spaces-secret"
MINIO_BUCKET="your-bucket-name"
MINIO_USE_SSL=true
```

- $5/mo for 250GB + 1TB transfer
- Built-in CDN and redundancy
- Works with existing MinIO adapter (S3-compatible)

**AWS S3, Google Cloud Storage, Azure Blob** - Similar configuration, use respective endpoints.

#### Option 2: Self-Hosted MinIO with Block Storage

Run MinIO on a VPS with attached block storage volumes:

```yaml
# docker-compose.prod.yml
services:
  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    volumes:
      - /mnt/block-storage-volume:/data # Mounted block storage
```

**Pros:** Full control, no egress fees, predictable costs
**Cons:** You manage backups, scaling, and redundancy

#### Monitoring Storage Usage

1. **MinIO Console** - http://your-server:9001 for dashboard metrics
2. **Command line:**

   ```bash
   # Check volume size
   docker exec your-minio-container du -sh /data

   # Detailed bucket info
   docker exec your-minio-container mc alias set local http://localhost:9000 accesskey secretkey
   docker exec your-minio-container mc du local/assets
   ```

3. **MinIO Admin API** - Query for server info including storage metrics

#### Recommendation

Use **managed object storage** (Spaces, S3, etc.) unless you have specific requirements for self-hosting. Benefits:

- No infrastructure management
- Built-in redundancy and backups
- Scales automatically
- Your existing MinIO adapter works with all S3-compatible services

## Status

✅ **Section 1.2 (Storage Adapters) Complete!**

**Implemented:**

- ✅ `IStorageAdapter` interface with all required methods
- ✅ Local Storage Adapter with full functionality
- ✅ MinIO Storage Adapter with S3-compatible operations
- ✅ Storage Module with factory pattern
- ✅ Unit tests for both adapters
- ✅ Integration with Setup Module
- ✅ Storage connection testing
- ✅ Path traversal protection
- ✅ Encrypted credential storage

**Next Steps:**

- Section 1.3: Authentication Module
- Section 1.4: Users Module
- Section 1.5: API Keys Module
- Section 1.6: Assets Module (will use StorageModule)

## References

- [Phase 1 Backend Roadmap](../../../../roadmap/phase-1-backend.md)
- [Checkpoint 2: Storage Adapters Complete](../../../../roadmap/phase-1-backend.md#checkpoint-2-storage-adapters-complete)
