# Visual Plans

A self-contained Astro + React + MDX gallery for **visual plans and recaps** — scannable
implementation documents built from a fixed catalog of reusable block components. Author each
plan/recap as one MDX file, preview locally, and (optionally) deploy the static site to BFFless.

## Local-first

```bash
npm install      # once
npm run dev      # gallery at http://localhost:4321  (live reload)
npm run build    # static HTML -> dist/
npm run preview  # serve dist/ to confirm the deployed output
```

You never need to deploy to see your work — `npm run dev` renders everything locally.

## Add a plan or recap

Drop a new MDX file in `src/content/plans/` or `src/content/recaps/`. The gallery picks it up
automatically.

```mdx
---
title: My change
objective: One line on the outcome.
status: proposed        # proposed | approved | done
date: 2026-06-17
tags: [backend]
---
import { Meta, Callout, DataModel, Steps } from '@components';

<Meta title="My change" status="proposed" date="2026-06-17" objective="One line on the outcome." />

<Callout kind="decision">The load-bearing choice.</Callout>
<Steps items={[ 'First step', 'Second step' ]} />
```

See `src/content/plans/example-plan.mdx` and `src/content/recaps/example-recap.mdx` for every block
in use.

## Blocks

All exported from `@components`: `Meta`, `Callout`, `Steps`, `Checklist`, `Columns`, `DataModel`,
`ApiEndpoint`, `FileTree`, `Diff`, `Diagram`, `Wireframe`, `QuestionForm`, `Icon`.

Consistency comes from these components + the `--wf-*` design tokens in `src/styles/tokens.css`.
Edit a token once and every plan updates. Components never hard-code colors or fonts.

## Deploy (optional)

Copy `.github/workflows/deploy-visual-plans.yml` to your **repo root** `.github/workflows/`, set
the `ASSET_HOST_URL` variable and `ASSET_HOST_KEY` secret, and push. It builds `dist/` and uploads
via [`bffless/upload-artifact`](https://github.com/bffless/upload-artifact).
