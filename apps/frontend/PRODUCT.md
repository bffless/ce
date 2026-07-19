# Product

## Register

product

## Users

Developers and small teams self-hosting BFFless CE: they deploy static frontends from CI, manage deployment aliases and custom domains, wire proxy rules / pipelines as their backend, and administer users. Context is task-driven work — usually desktop, but increasingly on a phone to check a deployment, inspect data-table records, or flip an alias while away from a desk. Admins of the hosted platform (bffless.app workspaces) use the identical UI per-workspace.

## Product Purpose

BFFless CE admin panel: the single UI for a self-contained static-hosting + backend-for-frontend platform (deployments, branches, aliases, domains, traffic splitting, proxy rules, pipelines, data tables, uploads, users/groups, instance settings). Success = an operator can find and complete any management task quickly and confidently, on any device, without docs.

## Brand Personality

Pragmatic, calm, trustworthy. A developer tool in the GitHub/Vercel/shadcn lineage: neutral surfaces, dense-but-legible data, no marketing flourish inside the app. The tool should disappear into the task.

## Anti-references

- Marketing-style landing flourishes (hero gradients, oversized display type) inside the admin.
- Over-decorated dashboards (gradient stat cards, glassmorphism, decorative motion).
- Anything that breaks the "boring is trustworthy" contract of infra tools.

## Design Principles

1. **Task first** — every screen answers "what is this and what can I do" within seconds; chrome never competes with data.
2. **Same vocabulary everywhere** — one button, form, table, and empty-state grammar across all 30+ pages.
3. **Works one-handed** — the admin is genuinely used from phones; responsive behavior is structural (collapsing nav, stacking tables), not an afterthought.
4. **State is visible** — loading, empty, error, and success states are designed, not defaulted.
5. **Earned familiarity** — follow the conventions of the best dev tools (GitHub, Vercel, Linear) rather than inventing affordances.

## Accessibility & Inclusion

WCAG 2.1 AA target: 4.5:1 body contrast, full keyboard operability (Radix primitives help), visible focus, labeled icons, `sr-only` support already present. Respect `prefers-reduced-motion` and `prefers-color-scheme` (light + dark themes are both first-class).
