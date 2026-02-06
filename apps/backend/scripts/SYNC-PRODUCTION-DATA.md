# Syncing Production Data to Local Development

This guide explains how to sync production database and storage files to your local development environment.

## Overview

You have three sync options:

### 1. Complete Sync (Database + Storage) - **RECOMMENDED**
The `sync-production-complete.sh` script syncs both database and MinIO storage:
- Syncs database tables and records
- Syncs all files from production MinIO to local MinIO
- Ensures your local environment exactly matches production

### 2. Database Only Sync
The `sync-production-to-local.sh` script syncs only the database:
1. Creates an SSH tunnel to your production database
2. Dumps the production database
3. Replaces your local database with production data
4. Restarts necessary services

### 3. Storage Only Sync
The `sync-production-storage.sh` script syncs only MinIO files:
1. Creates an SSH tunnel to production MinIO
2. Mirrors all files from production to local MinIO using Docker (no installation required!)
3. Preserves file structure and metadata

## Prerequisites

**All you need is:**
- SSH access to your production server (Digital Ocean droplet)
- Production credentials (database password, MinIO keys)
- Docker running locally (already required for `pnpm dev:services`)
- Local containers running: `docker compose -f docker-compose.dev.yml up -d`

**No additional tools required!** The scripts use Docker to run PostgreSQL and MinIO clients - no global installations needed.

## Usage

### Complete Sync (Database + Storage) - **RECOMMENDED**

This is the easiest way to get a complete copy of production data:

```bash
cd apps/backend

# Using pnpm (recommended)
pnpm sync:production \
  --host YOUR_DROPLET_IP \
  --db-password YOUR_DB_PASSWORD \
  --minio-access-key YOUR_MINIO_ACCESS_KEY \
  --minio-secret-key YOUR_MINIO_SECRET_KEY

# Or using bash directly
bash scripts/sync-production-complete.sh \
  --host YOUR_DROPLET_IP \
  --db-password YOUR_DB_PASSWORD \
  --minio-access-key YOUR_MINIO_ACCESS_KEY \
  --minio-secret-key YOUR_MINIO_SECRET_KEY
```

**Options for complete sync:**
- `--db-only` - Sync only database (skip storage)
- `--storage-only` - Sync only storage (skip database)
- `--storage-dry-run` - Preview what files would be synced without copying
- `--keep-dump` - Keep database dump file after import
- `--local-db-password PASSWORD` - Local database password (default: devpassword)
- `--local-minio-access-key KEY` - Local MinIO access key (default: minioadmin)
- `--local-minio-secret-key KEY` - Local MinIO secret key (default: minioadmin)
- `-y, --yes` - Skip all confirmation prompts

### Database Only Sync

```bash
cd apps/backend

# Using pnpm
pnpm db:sync-production --host YOUR_DROPLET_IP --password YOUR_DB_PASSWORD

# Or using bash
bash scripts/sync-production-to-local.sh \
  --host YOUR_DROPLET_IP \
  --password YOUR_PRODUCTION_DB_PASSWORD
```

### Storage Only Sync

```bash
cd apps/backend

# Using pnpm
pnpm storage:sync-production \
  --host YOUR_DROPLET_IP \
  --access-key YOUR_MINIO_ACCESS_KEY \
  --secret-key YOUR_MINIO_SECRET_KEY

# Or using bash
bash scripts/sync-production-storage.sh \
  --host YOUR_DROPLET_IP \
  --access-key YOUR_MINIO_ACCESS_KEY \
  --secret-key YOUR_MINIO_SECRET_KEY
```

**Storage sync options:**
- `--dry-run` - Show what would be synced without actually syncing
- `--bucket BUCKET` - Specify bucket name (default: assets)
- `--port PORT` - MinIO port on production (default: 9000)

### Using Environment Variables

You can set environment variables to avoid passing credentials on the command line:

```bash
export DROPLET_HOST="142.93.123.45"
export POSTGRES_PASSWORD_PROD="your-db-password"
export PROD_MINIO_ACCESS_KEY="minioadmin"
export PROD_MINIO_SECRET_KEY="your-minio-secret"

# Then run without arguments
pnpm sync:production
```

### Examples

**Complete sync to dev environment (most common use case):**
```bash
cd apps/backend
pnpm sync:production \
  --host mydomain.com \
  --db-password dbpass123 \
  --minio-access-key minioadmin \
  --minio-secret-key miniosecret
```

**Complete sync to Docker production environment:**
```bash
cd apps/backend
pnpm sync:production \
  --host mydomain.com \
  --db-password prod_db_password \
  --minio-access-key prod_minio_key \
  --minio-secret-key prod_minio_secret \
  --local-db-password test_secure_password_123 \
  --local-minio-access-key minioadmin \
  --local-minio-secret-key minioadmin
```

**Preview storage sync before running:**
```bash
cd apps/backend
pnpm storage:sync-production \
  --host mydomain.com \
  --access-key minioadmin \
  --secret-key miniosecret \
  --dry-run
```

**Sync only database (if you don't need files):**
```bash
cd apps/backend
pnpm db:sync-production \
  --host mydomain.com \
  --password dbpass123 \
  --yes
```

**Sync only storage files:**
```bash
cd apps/backend
pnpm storage:sync-production \
  --host mydomain.com \
  --access-key minioadmin \
  --secret-key miniosecret
```

## What Happens During Sync

### Complete Sync Process

1. **Safety Checks**: Verifies local PostgreSQL and MinIO containers are running
2. **Warning**: Displays sync plan and asks for confirmation
3. **Database Sync**:
   - Creates SSH tunnel to production database
   - Dumps production database to temporary file
   - Stops SuperTokens to close DB connections
   - Drops and recreates local database
   - Imports production data
   - Restarts services
4. **Storage Sync**:
   - Creates SSH tunnel to production MinIO
   - Configures MinIO client with credentials
   - Mirrors all files from production to local
   - Preserves file structure and metadata
5. **Cleanup**: Closes SSH tunnels and optionally removes temporary files

### Database-Only Sync Process

1. **Safety Check**: Verifies local PostgreSQL container is running
2. **Warning**: Displays warning about data loss and asks for confirmation
3. **SSH Tunnel**: Creates a secure tunnel to production database
4. **Database Dump**: Exports production database to a temporary file
5. **Service Stop**: Temporarily stops SuperTokens to close database connections
6. **Database Replace**: Drops local database and recreates it with production data
7. **Service Restart**: Restarts SuperTokens and other services
8. **Cleanup**: Closes SSH tunnel and optionally removes dump file

### Storage-Only Sync Process

1. **Safety Check**: Verifies local MinIO container is running
2. **MinIO Client Setup**: Uses Docker to run MinIO client (no installation needed)
3. **SSH Tunnel**: Creates secure tunnel to production MinIO
4. **Statistics**: Shows file counts before sync
5. **File Mirror**: Efficiently copies only changed/new files
6. **Verification**: Shows file counts after sync
7. **Cleanup**: Closes SSH tunnel and removes temporary config

## Important Warnings

⚠️ **DATA LOSS**: This script will completely replace your local database. All local data will be lost.

⚠️ **PRODUCTION ACCESS**: Ensure you have proper authorization to access production data.

⚠️ **SENSITIVE DATA**: Production data may contain sensitive user information. Handle with care and follow your organization's data protection policies.

## Troubleshooting

### SSH Connection Failed

If you can't connect to production:
- Verify your SSH key is added to the production server
- Check that you can manually SSH: `ssh root@YOUR_DROPLET_IP`
- Ensure the production server firewall allows SSH connections

### Tunnel Port Already in Use

If port 5433 or 9001 is already in use:
```bash
# Find and kill the process using the port
lsof -ti:5433 | xargs kill -9  # Database tunnel
lsof -ti:9001 | xargs kill -9  # MinIO tunnel
```

### Local Containers Not Running

If the script reports containers aren't running:
```bash
# Start all development containers
docker compose -f docker-compose.dev.yml up -d

# Or start specific services
docker compose -f docker-compose.dev.yml up -d postgres minio

# Verify they're running
docker ps | grep assethost
```

### Docker Not Available

The storage sync script uses Docker to run the MinIO client. If Docker is not running:
```bash
# Check if Docker is running
docker ps

# If not, start Docker Desktop or Docker daemon
```

### Storage Sync Failed - Cannot Access Bucket

If MinIO can't access the bucket:
- Verify the bucket name (default is `assets`)
- Check MinIO credentials are correct
- Ensure production MinIO is running on port 9000
- Try accessing MinIO console: `http://YOUR_DROPLET_IP:9001`

### Import Failed

If the database import fails, the dump file is preserved:
```bash
# View the dump file
less /tmp/production-db-dump-*.sql

# Manually import
export PGPASSWORD=devpassword
psql -h localhost -p 5432 -U postgres -d assethost -f /tmp/production-db-dump-*.sql
```

### Files Not Syncing

If storage files aren't syncing:
```bash
# Run a dry-run to see what would be synced
pnpm storage:sync-production --dry-run --host ... --access-key ... --secret-key ...

# Verify local MinIO is accessible
docker exec -it assethost-minio-dev mc ls local/assets

# Check production SSH tunnel can be established
ssh root@YOUR_DROPLET_IP "docker exec minio mc ls local/assets"
```

## Best Practices

1. **Regular Syncs**: Sync production data regularly to keep your local environment up-to-date
2. **Complete Sync**: Use `sync:production` to sync both database and files - they're linked!
3. **Dry Run First**: Use `--storage-dry-run` to preview file sync before executing
4. **Test Data**: After syncing, verify both database records and files are accessible
5. **Migrations**: If your local schema is ahead of production, run migrations after sync
6. **Backup**: Consider keeping dump files for a while using `--keep-dump`
7. **Security**: Store production credentials securely (use environment variables or password managers)
8. **Disk Space**: Ensure you have enough disk space for the storage sync (check production bucket size first)
9. **Docker Production**: When syncing to your local Docker production environment (docker-compose.yml), use `--local-db-password` to specify your local database password from the `.env` file

## After Syncing

1. **Update storage config for local development** (required when running backend outside Docker):
   ```bash
   node scripts/update-local-storage-config.js
   ```
   This changes the MinIO endpoint from `minio` (Docker service name) to `localhost`.

2. **Restart your backend server** if it's running
3. **Run pending migrations** if your local schema is different:
   ```bash
   cd apps/backend
   pnpm db:migrate
   ```
4. **Verify storage access**:
   - Visit MinIO console: http://localhost:9001 (minioadmin/minioadmin)
   - Check that files are present in the `assets` bucket
   - Test file uploads/downloads in your app
5. **Clear any caches** your application might have
6. **Test critical features** to ensure everything works with production data

## Alternative: Using the Dump File Directly

If you have a recent dump file, you can import it directly without connecting to production:

```bash
# Create fresh database
export PGPASSWORD=devpassword
dropdb -h localhost -p 5432 -U postgres --if-exists assethost
createdb -h localhost -p 5432 -U postgres assethost

# Import dump
psql -h localhost -p 5432 -U postgres -d assethost -f /path/to/dump.sql
```

## Quick Reference

```bash
# Complete sync (database + storage)
cd apps/backend
pnpm sync:production --host IP --db-password PASS --minio-access-key KEY --minio-secret-key SECRET

# Database only
pnpm db:sync-production --host IP --password PASS

# Storage only
pnpm storage:sync-production --host IP --access-key KEY --secret-key SECRET

# Preview storage sync
pnpm storage:sync-production --host IP --access-key KEY --secret-key SECRET --dry-run
```

## Related Scripts

- `sync-production-complete.sh` - Sync both database and storage (recommended)
- `sync-production-to-local.sh` - Sync only database
- `sync-production-storage.sh` - Sync only MinIO storage
- `tunnel-to-production-db.sh` - Create an SSH tunnel for manual database access
- `reset-database.sh` - Reset local database to empty state
- `dev-reset-and-setup.sh` - Reset and seed local database with test data

## Why Sync Both Database and Storage?

Your database contains references to files stored in MinIO:
- Asset metadata (file paths, sizes, types)
- Deployment records with file references
- User uploads and attachments

If you sync only the database, you'll have records pointing to files that don't exist locally. If you sync only storage, you'll have files without database records. **Always sync both for a complete local environment.**
