# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Documentation restructuring with new `docs/` hierarchy
- Configuration guides for environment variables, storage backends, and authentication
- Reference documentation for API, architecture, database schema, and security
- Troubleshooting guide with common issues and solutions
- Deployment guides for Docker Compose, DigitalOcean, and GitHub Actions
- Quick start guide with automated install script
- Local development setup guide

### Changed

- Simplified README.md with links to detailed documentation
- Consolidated scattered documentation into organized structure
- Moved deployment-specific docs from roadmap/ to docs/deployment/

### Deprecated

- `IMPLEMENTATION_ROADMAP.md` (use `roadmap/README.md` instead)
- Legacy deployment files moved to `roadmap/archive/`

---

## [1.0.0] - Unreleased

### Added

- **Core Platform**
  - Asset upload from GitHub Actions via custom action
  - Web-based asset browser with intuitive interface
  - Project management with owner/repository structure
  - Deployment alias system (production, staging, etc.)

- **Authentication & Authorization**
  - SuperTokens integration for user authentication
  - Email/password login with secure sessions
  - API key authentication for CI/CD pipelines
  - Role-based access control (admin, user)
  - Project-level permissions

- **Storage**
  - Pluggable storage adapter system
  - MinIO (S3-compatible) support - recommended for production
  - Local filesystem storage for development
  - Encrypted storage credentials in database

- **Domain Management**
  - Custom domain mapping
  - Subdomain routing
  - Dynamic nginx configuration
  - SSL certificate support via Let's Encrypt

- **Proxy Rules**
  - Reverse proxy configuration for API forwarding
  - Path-based routing rules
  - Header manipulation (forward, strip, add)
  - Project-level and alias-level rule inheritance

- **Infrastructure**
  - Docker Compose deployment
  - Pre-built images on GitHub Container Registry
  - nginx reverse proxy with SSL termination
  - PostgreSQL database with Drizzle ORM
  - SuperTokens authentication service
  - Health check endpoints

- **Developer Experience**
  - Automated install script (`install.sh`)
  - Setup wizard for initial configuration
  - Swagger API documentation
  - Comprehensive error messages

### Security

- AES-256 encryption for storage credentials
- bcrypt hashing for API keys and passwords
- SSRF protection in proxy rules
- HTTP-only secure cookies
- CORS configuration
- Security headers (X-Frame-Options, CSP, etc.)

---

## Versioning

This project uses [Semantic Versioning](https://semver.org/):

- **MAJOR** version for incompatible API changes
- **MINOR** version for backwards-compatible functionality additions
- **PATCH** version for backwards-compatible bug fixes

---

## Upgrade Guide

When upgrading between versions:

1. Check this changelog for breaking changes
2. Back up your database and `ENCRYPTION_KEY`
3. Pull new Docker images: `docker compose pull`
4. Apply database migrations: `docker compose exec backend pnpm db:migrate`
5. Restart services: `docker compose up -d`

---

## Links

- [Documentation](./docs/README.md)
- [GitHub Repository](https://github.com/bffless/ce)
- [Issue Tracker](https://github.com/bffless/ce/issues)
