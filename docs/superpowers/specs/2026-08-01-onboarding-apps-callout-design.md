# Onboarding Modal: App-Install Callout — Design

**Date:** 2026-08-01
**Status:** Approved (design), pending implementation plan
**Context:** CE ≥ 0.4.0 ships the app catalog (Admin → Apps at `/apps`, 1-click install) and the
public store at `https://apps.bffless.dev` (bffless/apps#273). The first-login onboarding modal
(`OnboardingModal` on `HomePage`) still only walks through the repo → API key → GitHub Actions
path. This change makes installing an app the primary next-step callout while keeping that path.

## Decisions made during brainstorming

1. **Two-path welcome** — `WelcomeStep` becomes a fork: primary "install an app" card, secondary
   "deploy your own site" card continuing the existing 3-step wizard. No new step; wizard stays
   4 steps. The walkthrough video stays.
2. **CTA completes onboarding** — clicking "Browse apps" marks onboarding complete, closes the
   modal, and navigates to the in-instance `/apps` page (where install actually happens). The
   card also carries a small external "see what's available" link to `https://apps.bffless.dev`
   (new tab).
3. **Role-gated** — the modal shows for `admin` and `user` roles, but `/apps` is admin-only
   (`requireAdmin` route). Non-admin users see the current single-path welcome unchanged.

## Scope

CE frontend only:

| File | Change |
| --- | --- |
| `apps/frontend/src/components/setup/onboarding/WelcomeStep.tsx` | Two-path layout (admin) / current layout (non-admin) |
| `apps/frontend/src/components/setup/onboarding/OnboardingModal.tsx` | New `onInstallApps` handler: `completeOnboarding` + close + `navigate('/apps')` |
| `apps/frontend/src/lib/docsLinks.ts` | new exported `APP_STORE_URL = 'https://apps.bffless.dev'` beside `DOCS`/`VIDEOS` |
| Both `.test.tsx` suites | Updated + new cases (below) |

Explicitly unchanged: onboarding persistence (`hasCompletedOnboarding` in localStorage via
`setupSlice`), the modal's show conditions on `HomePage`, steps 2–4, routing.

## WelcomeStep layout (admin)

Intro copy updated to frame the choice. Then, under the existing video facade:

- **Primary card — "Install a ready-made app."** Copy: apps like Handoff install onto this
  instance in one click — frontend, backend rules, and domain included. Primary button
  **Browse apps** → `onInstallApps`. Small external link "See what's available ↗" →
  `APP_STORE_URL`, `target="_blank" rel="noreferrer"`.
- **Secondary card — "Deploy your own site."** Copy: create a repository, generate an API key,
  and wire up a GitHub Actions deploy. Button (secondary/outline variant) → `onNext` (existing
  wizard, unchanged).
- **"Skip for now"** ghost button stays.

Non-admin (`role !== 'admin'`): render exactly the current layout (intro copy, video, docs link,
Skip / Get Started). The role reaches WelcomeStep as a prop or via `useGetSessionQuery` (already
cached from `HomePage`); pick whichever keeps the step component presentational — recommendation:
pass `showAppsPath: boolean` down from `OnboardingModal`, which reads the session.

## OnboardingModal wiring

New `handleInstallApps`: `dispatch(completeOnboarding())`, `onClose()`, `navigate('/apps')`
(`useNavigate` from react-router). Passed as `onInstallApps` to `WelcomeStep`, alongside the
existing `onNext`/`onSkip`. Step title for step 1 stays `Welcome to {siteName}`.

## Error handling / edge cases

- `/apps` renders its own empty/error states (registry unreachable, air-gapped) — the modal does
  not preflight the registry. The external store link is informational only; the install action
  respects the instance's `APPS_REGISTRY_URL` because it happens on `/apps`.
- Modal show conditions are untouched, so users who already have repos or completed onboarding
  never see the new layout — no migration concerns for the localStorage flag.

## Testing

Vitest (existing suites extended):

- `WelcomeStep`: admin sees both path cards; "Browse apps" fires `onInstallApps`; the external
  store link has the right href/target; non-admin sees no apps card and the legacy buttons;
  existing video-facade tests keep passing.
- `OnboardingModal`: install path dispatches `completeOnboarding`, closes, navigates to `/apps`
  (router mocked/asserted); existing step-progression tests unchanged.

Visual validation with the headless browser if a local backend is feasible; otherwise component
tests + `pnpm --filter frontend exec tsc --noEmit` + build.

## Process

Branch `onboarding-apps-callout` via the `repos/ce` worktree convention (shared checkout — never
work on `main` directly). PR to `bffless/ce`. Note: frontend lint fails on `main` pre-existing
(58 problems) — gate on type-check/tests/build, not repo-wide lint.
