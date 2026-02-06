# Development Scripts

Quick setup and reset scripts for development workflow.

All scripts are bash scripts located in `apps/backend/scripts/`.

## Prerequisites

### Required (Always)

1. **PostgreSQL** - Database (Docker or local)

   ```bash
   # Start with Docker (recommended):
   docker-compose -f docker-compose.dev.yml up -d postgres

   # Or ensure local PostgreSQL is running on port 5432
   ```

2. **Backend** - API server running

   ```bash
   cd apps/backend
   pnpm dev
   ```

### Optional (Only for MinIO setup)

3. **MinIO** - Object storage (only needed for `setup:minio` or `dev:reset-minio`)

   ```bash
   docker-compose -f docker-compose.dev.yml up -d minio
   ```

---

**Summary:**

- `setup:local` → Needs: PostgreSQL + Backend
- `setup:minio` → Needs: PostgreSQL + Backend + MinIO

## Quick Start

### One-Command Setup & Reset

```bash
# Reset and setup with LOCAL storage (fastest)
pnpm dev:reset-local

# Reset and setup with MINIO storage
pnpm dev:reset-minio
```

These commands will:

1. Delete all users and system config
2. Create a fresh admin user
3. Configure storage (local or MinIO)
4. Complete the setup

---

## Individual Commands

### Reset Options

```bash
# 🎯 Reset setup state only (most common - keeps DB structure)
pnpm db:reset-setup

# 🧹 Clear SuperTokens user authentication data
pnpm db:reset-supertokens     # Requires typing "yes"

# 🔥 Nuclear reset - DESTROYS entire database
pnpm db:reset                 # Requires confirmation - very destructive!

# 🚀 Nuclear reset + auto-migrate + restart SuperTokens
pnpm db:reset:complete        # Full workflow reset
```

### Setup Only (No Reset)

```bash
# Setup with local storage
pnpm setup:local

# Setup with MinIO storage
pnpm setup:minio
```

**Note**: Setup scripts will fail if setup is already complete. Reset first.

---

## Customization

### Environment Variables

You can override defaults using environment variables:

```bash
# Custom admin credentials
ADMIN_EMAIL="myemail@example.com" \
ADMIN_PASSWORD="MyPassword123!" \
pnpm setup:local

# Custom local storage path
LOCAL_PATH="/var/uploads" pnpm setup:local

# Custom MinIO settings
MINIO_ENDPOINT="minio.example.com:9000" \
MINIO_ACCESS_KEY="mykey" \
MINIO_SECRET_KEY="mysecret" \
MINIO_BUCKET="my-assets" \
pnpm setup:minio
```

### Defaults

**Admin User:**

- Email: `admin@example.com`
- Password: `SecurePassword123!`

**Local Storage:**

- Path: `./uploads`

**MinIO Storage:**

- Endpoint: `localhost:9000`
- Access Key: `minioadmin`
- Secret Key: `minioadmin`
- Bucket: `assets`
- Use SSL: `false`

---

## Scripts Reference

All scripts are in `apps/backend/scripts/`:

### 🔄 Reset Scripts

| Script                       | Purpose                                 | Destructiveness  |
| ---------------------------- | --------------------------------------- | ---------------- |
| `reset-setup.sh`             | Reset setup state (users & config only) | 🎯 Surgical      |
| `reset-supertokens-users.sh` | Clear SuperTokens authentication data   | 🧹 Targeted      |
| `reset-database.sh`          | **DESTROY** entire database             | 🔥 Nuclear       |
| `reset-database-complete.sh` | Nuclear reset + auto-migrate + restart  | 🚀 Full workflow |

### 🚀 Setup Scripts

| Script                   | Purpose                           |
| ------------------------ | --------------------------------- |
| `setup-local.sh`         | Complete setup with local storage |
| `setup-minio.sh`         | Complete setup with MinIO storage |
| `dev-reset-and-setup.sh` | Reset + setup (combined workflow) |

### 🔧 Utility Scripts

| Script                         | Purpose                             |
| ------------------------------ | ----------------------------------- |
| `test-storage-adapters.sh`     | Interactive storage adapter testing |
| `run-migrations-production.sh` | Production database migrations      |
| `check-migrations.sh`          | Verify migration status             |

---

## Database Migrations

### Production Migration Workflow

After starting production containers with `pnpm docker:up`, **always run migrations and verify**:

```bash
# 1. Run migrations
pnpm --filter backend db:migrate:prod

# 2. ALWAYS verify they applied correctly
pnpm --filter backend db:check
```

### Migration Commands

| Command           | Purpose                                | When to Use                      |
| ----------------- | -------------------------------------- | -------------------------------- |
| `db:generate`     | Generate migration from schema changes | After editing `src/db/schema.ts` |
| `db:migrate`      | Apply migrations locally               | Local development                |
| `db:migrate:prod` | Apply migrations in Docker             | After `docker:up`                |
| `db:check`        | Verify migration status                | After running migrations         |

### When to Run Migrations

1. **After `docker:up`** - Always run `db:migrate:prod` then `db:check`
2. **After schema changes** - Run `db:generate`, then `db:migrate` or `db:migrate:prod`
3. **After pulling new code** - Check for new migration files, then run migrations

### Troubleshooting Migrations

#### `db:check` shows mismatch

```bash
# Check file permissions in container
docker exec assethost-backend ls -la /app/apps/backend/drizzle/

# If files show -rw------- (no read permission), fix locally:
chmod 644 apps/backend/drizzle/*.sql

# Rebuild and restart
docker-compose build backend
docker-compose up -d backend

# Re-run migrations
pnpm --filter backend db:migrate:prod
pnpm --filter backend db:check
```

#### Migrations say "completed" but tables missing

This usually means Drizzle couldn't read the migration file. Check permissions:

```bash
# Verify all .sql files are readable
ls -la apps/backend/drizzle/*.sql

# All should show -rw-r--r-- (644), not -rw------- (600)
# Fix if needed:
chmod 644 apps/backend/drizzle/*.sql
```

#### Manual migration application

If automated migrations fail, apply manually:

```bash
# Run the SQL directly
docker exec assethost-backend cat /app/apps/backend/drizzle/XXXX_migration_name.sql | \
  docker exec -i assethost-postgres psql -U postgres -d assethost
```

### Creating New Migrations

```bash
# 1. Edit schema
vim apps/backend/src/db/schema.ts

# 2. Generate migration
pnpm --filter backend db:generate

# 3. Review generated SQL
cat apps/backend/drizzle/*.sql | tail -100

# 4. Ensure correct permissions
chmod 644 apps/backend/drizzle/*.sql

# 5. Test locally
pnpm --filter backend db:migrate

# 6. Commit the migration file
git add apps/backend/drizzle/
git commit -m "feat: add migration for X"
```

### Verifying Database State

```bash
# List all tables
docker exec assethost-postgres psql -U postgres -d assethost -c '\dt'

# Check specific table structure
docker exec assethost-postgres psql -U postgres -d assethost -c '\d assets'

# List indexes
docker exec assethost-postgres psql -U postgres -d assethost -c '\di'

# Check migration count
docker exec assethost-postgres psql -U postgres -d assethost -c \
  "SELECT COUNT(*) FROM drizzle.\"__drizzle_migrations\";"
```

---

## Common Workflows

### 🎯 Recommended Fresh Start (Daily Development)

```bash
# One command for fresh development environment
pnpm dev:reset-local
```

### 🧪 Testing Setup Flow

```bash
# 1. Reset to fresh state
pnpm db:reset-setup

# 2. Run setup manually or via script
curl http://localhost:3000/api/setup/status
# ... manual curl commands ...

# OR use quick setup
pnpm setup:local
```

### 🔥 Complete Fresh Start (Clean Slate)

```bash
# Option A: Step by step
pnpm db:reset-setup              # Reset setup data
pnpm db:reset-supertokens        # Clear SuperTokens (type "yes")
pnpm setup:local                 # Run fresh setup

# Option B: Nuclear + auto-migrate
pnpm db:reset:complete           # Destroys DB + migrates
pnpm db:reset-supertokens        # Clear SuperTokens (type "yes")
pnpm setup:local                 # Run fresh setup

# Option C: Development convenience (RECOMMENDED)
pnpm dev:reset-local             # Fastest for daily work
```

### Switching Between Storage Types

```bash
# Currently using local? Switch to MinIO:
pnpm dev:reset-minio

# Switch back to local:
pnpm dev:reset-local
```

### Quick Development Loop

```bash
# Make changes to setup module...

# Test with fresh setup
pnpm dev:reset-local

# Backend auto-reloads, setup runs automatically
# Test your changes immediately!
```

---

## Troubleshooting

### "Setup already complete"

Choose your reset level and run setup:

```bash
# Most common - keeps database structure
pnpm db:reset-setup
pnpm setup:local

# Or use the one-command approach
pnpm dev:reset-local
```

### "Email already exists" during setup

Clear SuperTokens users and try again:

```bash
pnpm db:reset-supertokens        # Type "yes" when prompted
pnpm setup:local
```

### "Connection refused" or "Cannot find PostgreSQL"

Make sure PostgreSQL is running:

```bash
# Check if Docker container is running
docker ps | grep postgres

# If not, start it:
docker-compose -f docker-compose.dev.yml up -d postgres

# Or if using local PostgreSQL, ensure it's running on port 5432
```

### "Cannot find PostgreSQL" (Different container name)

If your PostgreSQL container has a different name:

```bash
# Find your container name
docker ps --format '{{.Names}}' | grep postgres

# Set it as env var
DB_CONTAINER="your-container-name" pnpm db:reset-setup
```

### Backend not responding

Make sure backend is running:

```bash
pnpm dev
```

### MinIO setup fails

Make sure MinIO is running:

```bash
docker-compose -f docker-compose.dev.yml up -d minio
```

### Script permission denied

Make scripts executable:

```bash
chmod +x scripts/*.sh
```

---

## API Flow

Each setup script follows this flow:

```
1. GET  /api/setup/status          Check if setup needed
2. POST /api/setup/initialize      Create admin user
3. POST /api/setup/storage         Configure storage backend
4. POST /api/setup/test-storage    Verify storage works
5. POST /api/setup/complete        Finalize setup
6. GET  /api/setup/status          Confirm completion
```

---

## Production Deployment

For production deployment instructions, see the complete guide at:

**`roadmap/deploy-digitalocean-simple.md`**

This guide covers:

- Setting up a DigitalOcean droplet (or any Ubuntu VPS)
- Configuring SSL/HTTPS with Let's Encrypt
- Cloning from private GitHub repositories
- Environment configuration
- Docker setup and deployment
- Database migrations
- Troubleshooting

---

## Development Warning

⚠️ **Setup/Reset scripts are for DEVELOPMENT ONLY**

Do NOT use development scripts in production:

- No safety checks
- Hardcoded passwords
- Automated destructive operations

For production, use `deploy-to-droplet.sh` or follow the manual setup process with secure credentials.

---

## Testing Scripts

### Test Upload Coverage

Script to test the `createDeployment` endpoint by recursively uploading all files from the `coverage/` directory.

**Location:** `scripts/test-upload-coverage.js`

#### Setup

1. Copy the example environment file:

   ```bash
   cp .env.test-upload.example .env.test-upload
   ```

2. Edit `.env.test-upload` with your configuration:
   ```env
   API_URL=http://localhost:3000
   API_KEY=your-actual-api-key
   REPOSITORY=your-org/your-repo
   COMMIT_SHA=abc1234567
   BRANCH=main
   IS_PUBLIC=false
   DESCRIPTION=Test deployment from coverage files
   ```

#### Usage

1. Generate coverage files:

   ```bash
   pnpm test
   ```

2. Run the upload test:

   ```bash
   pnpm test:upload
   ```

   Or directly:

   ```bash
   node scripts/test-upload-coverage.js
   ```

3. You can also override environment variables inline:
   ```bash
   API_KEY=your-key REPOSITORY=org/repo pnpm test:upload
   ```

#### What it does

- Recursively finds all files in `apps/backend/coverage/`
- Uploads up to 50 files to the `POST /api/deployments` endpoint
- Preserves directory structure using relative paths as filenames
- Reports upload progress and results
- Displays deployment details including URLs and aliases

#### Output

The script will display:

- List of files being uploaded with sizes
- Upload status
- Deployment ID and details
- Public URLs for accessing the deployment
- Any aliases created
- Any failed uploads
