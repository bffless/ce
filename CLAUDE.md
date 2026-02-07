# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A self-contained platform for hosting static assets and build artifacts from CI/CD pipelines. Built with NestJS (backend), React (frontend), PostgreSQL, and pluggable storage adapters (Local, MinIO, S3, GCS, Azure).

## Development Commands

### Setup

```bash
# Install dependencies
pnpm install

# Set up environment file (REQUIRED before first run)
cp .env.example .env

# Generate ENCRYPTION_KEY (REQUIRED - encrypts storage credentials in DB)
ENCRYPTION_KEY=$(openssl rand -base64 32)
sed -i.bak "s/^ENCRYPTION_KEY=.*/ENCRYPTION_KEY=$ENCRYPTION_KEY/" .env
rm .env.bak

# Start development (runs migrations automatically)
pnpm dev:full
```

### Running Locally

```bash
# All-in-one (recommended): services + backend + frontend
pnpm dev:full

# Or individually:
pnpm dev:services        # Start PostgreSQL + MinIO (Docker)
pnpm dev                 # Run backend + frontend
```

### Testing

```bash
# All tests
pnpm test

# Backend tests
cd apps/backend
pnpm test                # All tests with coverage
pnpm test:watch          # Watch mode
pnpm test:e2e            # E2E tests

# Frontend tests
cd apps/frontend
pnpm test                # Vitest unit tests with coverage
pnpm test:ui             # Vitest UI
pnpm test:e2e            # Playwright E2E tests
pnpm test:e2e:ui         # Playwright UI mode
pnpm test:e2e:debug      # Playwright debug mode
```

### Type Checking

```bash
# Frontend
pnpm --filter frontend exec tsc --noEmit

# Backend
pnpm --filter backend exec tsc --noEmit
```

### Building

```bash
# All apps
pnpm build

# Individual apps
pnpm build:backend
pnpm build:frontend
```

### Database Operations

**IMPORTANT:** This project uses Drizzle ORM with a schema-first approach. See migration guidelines below.

```bash
cd apps/backend

# Generate migrations from schema changes
pnpm db:generate

# Run migrations
pnpm db:migrate

# Open Drizzle Studio (local dev DB)
pnpm db:studio

# Open Drizzle Studio (Docker DB)
pnpm db:studio:docker

# Stop Drizzle Studio
pnpm db:studio:stop
```

## Architecture

### Monorepo Structure

- **apps/backend** - NestJS API server
  - **src/auth** - SuperTokens authentication with session/API key guards
  - **src/storage** - Pluggable storage adapters (Local, MinIO, S3, GCS, Azure)
  - **src/assets** - Asset upload/download endpoints
  - **src/deployments** - Deployment management and alias system
  - **src/repo-browser** - Repository file browsing
  - **src/setup** - First-run setup wizard
  - **src/db/schema** - Drizzle ORM schemas (source of truth for database)
  - **drizzle/** - Generated SQL migrations

- **apps/frontend** - React SPA with Vite
  - **src/services** - RTK Query API definitions
  - **src/store** - Redux Toolkit slices
  - **src/pages** - Route components
  - **src/components** - Reusable UI components (Radix UI + Tailwind)

- **packages/github-action** - GitHub Action for uploading assets from CI/CD

### Key Architectural Patterns

#### Storage Abstraction Layer

All storage operations go through the `IStorageAdapter` interface in `apps/backend/src/storage/storage.interface.ts`. This enables switching between storage backends without changing application code.

**Storage key format (critical):**
```
{owner}/{repo}/{commitSha}/{path}/{filename}
```

Examples:
- `owner/repo/abc123def456/index.html`
- `owner/repo/abc123def456/css/style.css`

**Benefits:**
- SHA-based immutability
- Storage-agnostic (works with local filesystem and object storage)
- Easy migration between storage backends
- Matches GitHub repository structure

**Available adapters:**
- `LocalStorageAdapter` - Filesystem storage (dev/small deployments)
- `MinioStorageAdapter` - S3-compatible object storage (production)
- Future: AWS S3, Google Cloud Storage, Azure Blob Storage

**Adapter injection:** The `StorageModule` is configured dynamically in `app.module.ts` using `forRootAsync()` to load configuration from the database via `SetupService`.

#### Authentication

Uses **SuperTokens** for session-based auth with two guard types:

1. **SessionAuthGuard** - Requires authenticated user session (for web UI)
2. **ApiKeyGuard** - Validates `X-API-Key` header (for GitHub Actions/CI)
3. **OptionalAuthGuard** - Allows both authenticated and public access

**Authorization:** Role-based guards (`@Roles(['admin'])`) and custom decorators (`@CurrentUser()`).

#### Database Migrations (CRITICAL)

**Schema-First Approach:** NEVER write manual SQL migrations. Always modify TypeScript schema files.

Workflow:
```bash
cd apps/backend

# 1. Edit schema files in src/db/schema/*.schema.ts
# 2. Generate migration
pnpm db:generate

# 3. Review generated SQL in drizzle/*.sql
# 4. Apply migration
pnpm db:migrate
```

**Why?** Manual SQL migrations break Drizzle's snapshot tracking. Schema files are the source of truth.

**Exception:** Manual SQL is OK for data migrations only (INSERT/UPDATE/DELETE), not schema changes (CREATE/ALTER TABLE).

#### Frontend State Management

**RTK Query** for API calls with automatic caching:
- Base API defined in `src/services/api.ts`
- Injected endpoints in `src/services/repoApi.ts`
- Tag-based cache invalidation (`Asset`, `ApiKey`, `User`, `Setup`)

**Redux slices** in `src/store/slices/` for global UI state.

**API config:**
- Base URL uses `VITE_API_URL` env var, defaults to empty (Vite proxy handles routing in dev)
- `credentials: 'include'` - Required for session cookies

#### Public Content Request Routing (CRITICAL)

Understanding the nginx → backend request flow is essential for debugging domain-related features (traffic splitting, visibility, access control).

**Nginx has multiple server blocks** (defined in `docker/nginx/` templates + dynamically generated configs):

| Server Block | Location | Matches |
|---|---|---|
| `admin.PRIMARY_DOMAIN` | `main.conf` | Admin panel (serves React SPA + proxies `/api`, `/auth`, `/public`) |
| `*.PRIMARY_DOMAIN` | `main.conf` | **Wildcard catch-all** for all unmatched subdomains (including `www.`) |
| Per-domain configs | `sites-enabled/domain-{id}.conf` | Custom domains and primary domain (dynamically generated) |

**The wildcard catch-all is important**: If a request for `www.example.com` doesn't match a dedicated server block, it falls through to `*.example.com`, which routes to the **subdomain alias handler** — a different code path than expected.

**Three code paths serve public content** in `public.controller.ts`:

```
1. serveAliasAsset (line ~242)
   Route: GET /public/:owner/:repo/alias/:aliasName/*
   Used by: Per-domain nginx configs (custom domains, primary domain with dedicated server block)
   Has: Traffic splitting, visibility checks

2. serveSubdomainAlias (line ~321)
   Route: GET /public/subdomain-alias/:aliasName/*
   Used by: Wildcard *.PRIMARY_DOMAIN nginx block
   Flow: Looks up alias by name → if not found, falls back to serveDomainMappingFallback()

3. serveDomainMappingFallback (line ~698) [PRIVATE METHOD]
   Called by: serveSubdomainAlias when no alias matches (e.g., "www" isn't an alias)
   Resolves: domain mapping by X-Forwarded-Host header, handles www/non-www, primary domain lookup
   Has: Traffic splitting, www redirect behavior
```

**Common gotcha**: Primary domain with "Redirect to www" enabled stores `domain = 'j5s.dev'` in `domain_mappings`, but the generated nginx config may only have `server_name j5s.dev` (not `www.j5s.dev`). Requests to `www.j5s.dev` hit the wildcard catch-all → `serveSubdomainAlias` → `serveDomainMappingFallback`. Any feature added to `serveAliasAsset` must ALSO be added to `serveDomainMappingFallback` to work for primary domain www requests.

**Domain lookups must check both www and non-www variants** (the `selectVariant` and visibility service methods use `or()` queries for this).

**Key files:**
- `docker/nginx/` — Static nginx config templates (main.conf, admin, minio)
- `apps/backend/templates/nginx/` — Handlebars templates for per-domain configs
- `apps/backend/src/domains/nginx-config.service.ts` — Generates dynamic nginx configs
- `apps/backend/src/domains/nginx-startup.service.ts` — Regenerates all configs on startup
- `apps/backend/src/deployments/public.controller.ts` — All three serving code paths
- `apps/backend/src/domains/traffic-routing.service.ts` — Traffic splitting logic
- `apps/backend/src/domains/visibility.service.ts` — Access control resolution

#### Traffic Splitting (A/B Testing)

Split traffic across deployment aliases for A/B testing or canary deployments.

**How it works:**
- Configured per domain mapping via `domain_traffic_weights` table (e.g., 50% `production`, 50% `canary`)
- On first request: weighted random selection → sets `__bffless_variant` cookie + `X-Variant` response header
- Subsequent requests: reads cookie for sticky sessions (configurable duration, default 24h)
- Cookie: `__bffless_variant` (HttpOnly, Secure, SameSite=Lax)

**Implementation spans two code paths** (see routing section above):
- `serveAliasAsset` — for requests via dedicated domain nginx configs
- `serveDomainMappingFallback` — for requests via wildcard catch-all (including primary domain www)

**Key service:** `TrafficRoutingService.selectVariant(domainName, existingCookie)` — looks up domain (checking both www/non-www), queries weights, returns selected alias or null.

### Deployment Alias System

Deployments can have multiple access URLs:

1. **SHA URL** (immutable): `/repo/{owner}/{repo}/{commitSha}/`
2. **Alias URLs** (mutable): `/repo/{owner}/{repo}/alias/{alias}/`
   - Common aliases: `production`, `staging`, `dev`
   - Aliases point to specific commit SHAs

**Use case:** Pin `production` alias to a stable commit while new commits are uploaded.

## Common Workflows

### Adding a New API Endpoint

1. Create/update controller in `apps/backend/src/{module}/`
2. Add DTOs with `class-validator` decorators
3. Update Swagger docs with `@ApiOperation()`, `@ApiResponse()`
4. Add frontend RTK Query endpoint in `apps/frontend/src/services/{module}Api.ts`
5. Update cache tags if needed

### Adding a New Database Table

1. Create schema file in `apps/backend/src/db/schema/{name}.schema.ts`
2. Export from `apps/backend/src/db/schema/index.ts`
3. Run `cd apps/backend && pnpm db:generate`
4. Review generated SQL migration
5. Run `pnpm db:migrate`

### Running a Single Test

```bash
# Backend (Jest)
cd apps/backend
pnpm test -- <test-file-pattern>
pnpm test -- storage.adapter.spec

# Frontend (Vitest)
cd apps/frontend
pnpm test -- <test-file-pattern>

# Frontend E2E (Playwright)
cd apps/frontend
pnpm test:e2e -- <test-file>
pnpm test:e2e -- tests/upload.spec.ts
```

## Important Notes

### Security

- `ENCRYPTION_KEY` encrypts storage credentials in DB - NEVER change after initial setup
- API keys are hashed with bcrypt before storage
- Path traversal protection in all storage adapters
- SuperTokens handles session security

### CI/CD Workflows

The repository uses two GitHub Actions workflows:

**1. `main-release.yml`** - Triggered on push to main
- Type checking (frontend + backend)
- Testing with coverage upload
- Docker image build and push to GHCR
- Deployment to production (DigitalOcean)
- Automatic versioning and GitHub release creation
- Docker images tagged with: `latest`, `vX.Y.Z`, `main-<sha>`

**2. `pr-tests.yml`** - Triggered on pull requests
- Type checking (frontend + backend)
- Testing with coverage upload
- Frontend build preview (for PRs targeting main)

### Releases

Releases are created automatically on successful deploy to main:
- Version is auto-incremented (patch by default)
- Can trigger manual minor/major bumps via workflow dispatch
- Docker images are tagged with semantic version
- GitHub Release is created with auto-generated changelog
- `package.json` version is kept in sync

```bash
# Pull specific version
docker pull ghcr.io/bffless/ce-frontend:v0.1.5
docker pull ghcr.io/bffless/ce-backend:v0.1.5
```

### Docker

```bash
# Production deployment
pnpm docker:build
pnpm docker:up

# Reset workflows (useful for testing)
pnpm docker:reset:soft     # Restart containers (keeps data)
pnpm docker:reset:volumes  # Delete all data volumes
pnpm docker:reset:full     # Complete rebuild + fresh data
```

### Resetting the Platform

To reset the platform to a fresh state (useful for development/testing):

```bash
# Interactive reset with confirmation
pnpm docker:reset

# Force reset without confirmation (for CI/CD)
pnpm docker:reset:force

# Complete volume destruction and rebuild
pnpm docker:reset:volumes
```

The reset script will:
- Clear all data from PostgreSQL (users, projects, deployments, etc.)
- Delete all objects from MinIO storage
- Clear SuperTokens session data
- Re-run database migrations

After reset, visit the app to complete the setup wizard again.

### Environment Variables

Configuration is in `.env` at the project root. The backend loads this file via `envFilePath: '../../.env'` in `app.module.ts`.

**Critical vars:**
- `ENCRYPTION_KEY` - AES-256 key for encrypting storage credentials (REQUIRED, never change after setup)
- `DATABASE_URL` - PostgreSQL connection string (has default for local dev)
- `JWT_SECRET` - SuperTokens JWT secret (auto-generated if not set)
- `API_KEY_SALT` - Salt for API key hashing (auto-generated if not set)

**Frontend:** The Vite dev server proxies `/api` to the backend, so no frontend `.env` is needed for local development.

## Testing Strategy

- **Backend:** Jest with in-memory/mock implementations
- **Frontend:** Vitest for components, Playwright for E2E
- **Coverage:** Both apps generate coverage reports in `coverage/` directories
- **E2E:** Playwright runs in CI with Chromium only (`test:e2e:ci`)
