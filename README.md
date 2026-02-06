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

## Quick Start

Deploy in under 5 minutes:

```bash
sh -c "$(curl -fsSL https://raw.githubusercontent.com/bffless/ce/main/install.sh)"
```

Or see [Manual Setup](./docs/getting-started/manual-setup.md) for step-by-step instructions.

## Documentation

| Guide                                                            | Description                      |
| ---------------------------------------------------------------- | -------------------------------- |
| [Quick Start](./docs/getting-started/quickstart.md)              | 5-minute automated deployment    |
| [Manual Setup](./docs/getting-started/manual-setup.md)           | Step-by-step manual installation |
| [Local Development](./docs/getting-started/local-development.md) | Developer environment setup      |
| [Deployment Options](./docs/deployment/overview.md)              | Compare deployment methods       |
| [Configuration](./docs/configuration/environment-variables.md)   | All configuration options        |

## Technology Stack

**Backend:** NestJS, TypeScript, PostgreSQL, Drizzle ORM, SuperTokens

**Frontend:** React, TypeScript, Vite, Redux Toolkit, TailwindCSS, Radix UI

**Infrastructure:** Docker, Nginx, MinIO

## GitHub Action

Upload artifacts from your CI/CD pipeline:

```yaml
- name: Upload artifacts
  uses: your-org/asset-host-action@v1
  with:
    api-url: ${{ secrets.ASSET_HOST_URL }}
    api-key: ${{ secrets.ASSET_HOST_API_KEY }}
    files: |
      test-results/**/*.png
      coverage/index.html
```

## Contributing

Contributions welcome! See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

MIT License - see [LICENSE](./LICENSE) for details.

---

[Documentation](./docs/README.md) | [Changelog](./CHANGELOG.md) | [Issues](https://github.com/bffless/ce/issues)
