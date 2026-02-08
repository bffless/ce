# BFFless

[![Main Release](https://github.com/bffless/ce/actions/workflows/main-release.yml/badge.svg)](https://github.com/bffless/ce/actions/workflows/main-release.yml)
[![PR Tests](https://github.com/bffless/ce/actions/workflows/pr-tests.yml/badge.svg)](https://github.com/bffless/ce/actions/workflows/pr-tests.yml)

A self-contained platform for hosting images and static assets generated from CI/CD pipelines. View build artifacts like screenshots, test reports, and other generated assets through an intuitive web interface.

## Features

- **Easy Asset Upload** - GitHub Action for seamless artifact uploads from CI/CD
- **Web-Based Viewing** - Browse and view assets through a beautiful interface
- **Self-Contained Deployment** - Single Docker Compose deployment for any cloud
- **Flexible Storage** - Support for Local, MinIO, S3, GCS, and Azure Blob Storage
- **Secure Access** - Authentication and authorization for asset management

## Documentation

Full documentation is available at [docs.bffless.app](https://docs.bffless.app/).

| Section                                                               | Topics                                                                                                 |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [Getting Started](https://docs.bffless.app/category/getting-started/) | Quickstart, Cloudflare Setup, Let's Encrypt Setup, Setup Wizard, First Deployment, Viewing Deployments |
| [Features](https://docs.bffless.app/category/features/)               | Traffic Splitting, Share Links, Proxy Rules, Authorization, Repository Overview                        |
| [Deployment](https://docs.bffless.app/category/deployment/)           | Overview, DigitalOcean, SSL Certificates, GitHub Actions                                               |
| [Configuration](https://docs.bffless.app/category/configuration/)     | Environment Variables, Storage Backends, Authentication                                                |
| [Storage](https://docs.bffless.app/category/storage/)                 | AWS S3, Google Cloud Storage, Azure Blob Storage, MinIO, Caching, Migration Guide                      |
| [Reference](https://docs.bffless.app/category/reference/)             | API, Architecture, Database Schema, Security                                                           |
| [Troubleshooting](https://docs.bffless.app/troubleshooting/)          | Common issues and solutions                                                                            |

## Technology Stack

**Backend:** NestJS, TypeScript, PostgreSQL, Drizzle ORM, SuperTokens

**Frontend:** React, TypeScript, Vite, Redux Toolkit, TailwindCSS, Radix UI

**Infrastructure:** Docker, Nginx, MinIO

## GitHub Action

Upload artifacts from your CI/CD pipeline:

```yaml
- uses: bffless/upload-artifact@v1
  with:
    path: dist
    api-url: ${{ vars.ASSET_HOST_URL }}
    api-key: ${{ secrets.ASSET_HOST_KEY }}
```

Only 3 required inputs - repository, commit SHA, and branch are auto-detected from GitHub context.

## Contributing

Contributions welcome! See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## Author

Built by [Toshimoto](https://www.j5s.dev)

## License

O'Saasy License - see [LICENSE](./LICENSE) for details.

---

[Documentation](https://docs.bffless.app) | [Changelog](./CHANGELOG.md) | [Issues](https://github.com/bffless/ce/issues)
