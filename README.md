# BFFless

[![Main Release](https://github.com/bffless/ce/actions/workflows/main-release.yml/badge.svg)](https://github.com/bffless/ce/actions/workflows/main-release.yml)
[![PR Tests](https://github.com/bffless/ce/actions/workflows/pr-tests.yml/badge.svg)](https://github.com/bffless/ce/actions/workflows/pr-tests.yml)

**The home for your AI-generated apps, internal tools, and HTML docs — with a backend, auth, and a path to your internal services.**

BFFless gives static frontends real backend capabilities without standing up a server. Point any static site, dashboard, demo, or set of HTML docs at BFFless and get hosting, authentication, per-branch/commit previews, proxy rules to your internal APIs, traffic splitting, share links, and an AI chat endpoint — deployed as a single Docker stack and stored in Local, MinIO, S3, GCS, or Azure.

It's especially a natural home for the explosion of self-contained HTML apps and docs that AI coding agents produce: somewhere they can actually live inside a company, with a backend and access control, behind the corporate boundary.

> _Technical framing for those who know the category: a self-hosted Supabase/Appwrite aimed at static sites and internal apps._

## Features

- **Backend for static frontends** - Auth, proxy rules to internal services, and an AI chat endpoint — no server to run
- **Deployment previews** - Per-branch/commit URLs and mutable aliases (`production`, `staging`) for any deployment
- **Traffic splitting & share links** - A/B test across aliases; share private deployments via tokenized links
- **CI/CD artifact hosting** - GitHub Action for seamless artifact uploads (screenshots, reports, build output)
- **Self-Contained Deployment** - Single Docker Compose deployment for any cloud
- **Flexible Storage** - Support for Local, MinIO, S3, GCS, and Azure Blob Storage
- **Secure Access** - Authentication and authorization across content and management

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

## Claude Code Skills

Install the BFFless plugin for [Claude Code](https://claude.ai/code) to get AI-assisted development with platform knowledge built in.

```bash
# Add the BFFless plugin marketplace
/plugin marketplace add bffless/skills

# Install the plugin
/plugin install bffless
```

Once installed, Claude Code understands BFFless features — pipelines, proxy rules, chat, deployments, traffic splitting, and more. Just ask naturally:

- "Set up a proxy rule to forward /api requests to my backend"
- "Add AI chat to my site with streaming"
- "Configure traffic splitting for a canary deployment"

Available skills: `bffless`, `pipelines`, `chat`, `proxy-rules`, `traffic-splitting`, `authorization`, `repository`, `share-links`, `upload-artifact`

See the [claude-skills repo](https://github.com/bffless/claude-skills) for full documentation.

## Community

Join our [Discord](https://bffless.app/discord) for support, feature discussions, and updates.

## Contributing

Contributions welcome! See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## Author

Built by [Toshimoto](https://toshimoto.dev/?token=zYTp241X)

## License

O'Saasy License - see [LICENSE](./LICENSE) for details.

---

[Documentation](https://docs.bffless.app) | [Discord](https://bffless.app/discord) | [Changelog](./CHANGELOG.md) | [Issues](https://github.com/bffless/ce/issues)
