# Onboarding App-Install Callout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make installing an app the primary next-step callout in CE's first-login onboarding modal, keeping the existing create-repo wizard as the secondary path.

**Architecture:** Frontend-only. `WelcomeStep` becomes a two-path fork for admins (primary "install a ready-made app" card → `/apps`; secondary "deploy your own site" card → existing wizard) and stays byte-identical in behavior for non-admins (the `/apps` route is admin-only). `OnboardingModal` owns the new side effects (complete onboarding + close + navigate) and the role gate.

**Tech Stack:** React 18 + TypeScript, Redux Toolkit, react-router (`useNavigate`), Tailwind + shadcn-style `Button`, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-01-onboarding-apps-callout-design.md` (read it first).

## Global Constraints

- Work in the worktree `/home/rico/bffless/repos/ce/.claude/worktrees/onboarding-apps-callout` (branch `onboarding-apps-callout`). Never touch the main `repos/ce` checkout; never push to `main`; deliverable is a PR.
- Files changed are EXACTLY: `apps/frontend/src/lib/docsLinks.ts`, `apps/frontend/src/components/setup/onboarding/WelcomeStep.tsx` + `.test.tsx`, `OnboardingModal.tsx` + `.test.tsx`. Nothing else (no `setupSlice`, no `HomePage`, no steps 2–4).
- Store URL exact value: `export const APP_STORE_URL = 'https://apps.bffless.dev';` in `docsLinks.ts`.
- The in-instance target is the `/apps` route (admin-only). External store links open `target="_blank"` with `rel` containing `noopener`.
- Non-admin rendering must remain the CURRENT WelcomeStep layout (intro, video, docs link, Skip / Get Started).
- Repo gotchas: frontend lint already fails on `main` (58 pre-existing problems) — do NOT gate on repo-wide lint. `pnpm test:run -- <pattern>` does NOT filter — use `pnpm exec vitest run <path>` from `apps/frontend`.
- End every commit message with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: WelcomeStep two-path layout + store-URL constant

**Files:**
- Modify: `apps/frontend/src/lib/docsLinks.ts` (add one exported const after the `VIDEOS` block)
- Modify: `apps/frontend/src/components/setup/onboarding/WelcomeStep.tsx`
- Test: `apps/frontend/src/components/setup/onboarding/WelcomeStep.test.tsx`

**Interfaces:**
- Consumes: existing `DOCS`, `VIDEOS`, `DocsLink`, `Button`.
- Produces: `WelcomeStepProps` gains `onInstallApps: () => void` and `showAppsPath: boolean` (both REQUIRED props); `APP_STORE_URL: string` exported from `@/lib/docsLinks`. Task 2's modal passes both new props. Button labels Task 2's tests rely on: `Browse apps`, `Create a repository` (admin path), `Get Started` (non-admin path).

- [ ] **Step 1: Write the failing tests**

Replace `apps/frontend/src/components/setup/onboarding/WelcomeStep.test.tsx` with (existing four tests kept, adapted to the new required props via a `renderStep` helper; new tests added):

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WelcomeStep } from './WelcomeStep';
import { APP_STORE_URL, DOCS } from '@/lib/docsLinks';

const DOCS_URL = DOCS.gettingStarted.firstDeployment;

function renderStep(overrides: Partial<Parameters<typeof WelcomeStep>[0]> = {}) {
  const props = {
    onNext: vi.fn(),
    onSkip: vi.fn(),
    onInstallApps: vi.fn(),
    showAppsPath: false,
    ...overrides,
  };
  render(<WelcomeStep {...props} />);
  return props;
}

describe('WelcomeStep', () => {
  afterEach(cleanup);

  it('links to the first-deployment guide in a new tab', () => {
    renderStep();

    const link = screen.getByRole('link', { name: /first-deployment guide/i });
    expect(link).toHaveAttribute('href', DOCS_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('does not embed the YouTube iframe until play is pressed', async () => {
    renderStep();

    // Facade only — no third-party frame on first render.
    expect(document.querySelector('iframe')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /play video/i }));

    const iframe = document.querySelector('iframe');
    expect(iframe).not.toBeNull();
    // youtube-nocookie keeps a self-hosted install off Google's cookie domain.
    expect(iframe?.getAttribute('src')).toContain(
      'https://www.youtube-nocookie.com/embed/cNqh02HyD0s'
    );
  });

  it('advances on Get Started and dismisses on Skip for now', async () => {
    const { onNext, onSkip } = renderStep();

    await userEvent.click(screen.getByRole('button', { name: 'Get Started' }));
    expect(onNext).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('drops the thumbnail image when it fails to load, keeping the play control', () => {
    renderStep();

    const img = document.querySelector('img');
    expect(img).not.toBeNull();
    // A locked-down network (or blocked i.ytimg.com) must not leave a broken image.
    fireEvent.error(img!);

    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByRole('button', { name: /play video/i })).toBeInTheDocument();
  });

  it('hides the apps path entirely for non-admins', () => {
    renderStep({ showAppsPath: false });

    expect(screen.queryByRole('button', { name: 'Browse apps' })).toBeNull();
    expect(screen.queryByText(/ready-made app/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'Get Started' })).toBeInTheDocument();
  });

  it('shows both path cards for admins, with the apps card wired to onInstallApps', async () => {
    const { onInstallApps, onNext } = renderStep({ showAppsPath: true });

    expect(screen.getByText('Install a ready-made app')).toBeInTheDocument();
    expect(screen.getByText('Deploy your own site')).toBeInTheDocument();
    // The single-path CTA is replaced by the two cards' own buttons.
    expect(screen.queryByRole('button', { name: 'Get Started' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Browse apps' }));
    expect(onInstallApps).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Create a repository' }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('links the apps card to the public store in a new tab', () => {
    renderStep({ showAppsPath: true });

    const link = screen.getByRole('link', { name: /see what.s available/i });
    expect(link).toHaveAttribute('href', APP_STORE_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('keeps Skip for now available on the two-path layout', async () => {
    const { onSkip } = renderStep({ showAppsPath: true });

    await userEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run (from `apps/frontend`): `pnpm exec vitest run src/components/setup/onboarding/WelcomeStep.test.tsx`
Expected: FAIL — `APP_STORE_URL` has no export, and the admin-path tests can't find the cards. (The four legacy tests may fail on TS props too — fine.)

- [ ] **Step 3: Add the constant**

In `apps/frontend/src/lib/docsLinks.ts`, after the `VIDEOS` const:

```ts
/**
 * Public app-store showcase (bffless/apps). Informational only — the actual
 * 1-click install happens on this instance's /apps page, which respects
 * APPS_REGISTRY_URL for air-gapped installs.
 */
export const APP_STORE_URL = 'https://apps.bffless.dev';
```

- [ ] **Step 4: Rework WelcomeStep**

Replace the component (keep the file's video-facade block and its comments verbatim — only the props, intro copy, and the section below the video change):

```tsx
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { LayoutGrid, Play, Rocket } from 'lucide-react';
import { APP_STORE_URL, DOCS, VIDEOS } from '@/lib/docsLinks';
import { DocsLink } from '@/components/common/DocsLink';

const VIDEO_ID = VIDEOS.firstDeployment.id;
const VIDEO_TITLE = VIDEOS.firstDeployment.title;
const DOCS_URL = DOCS.gettingStarted.firstDeployment;

// hqdefault always exists for a public video (unlike maxresdefault), and is 4:3
// with letterbox bars — object-cover inside the 16:9 frame crops them off.
const thumbnailUrl = `https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`;

interface WelcomeStepProps {
  onNext: () => void;
  onSkip: () => void;
  /** Complete onboarding and route to the in-instance /apps catalog. */
  onInstallApps: () => void;
  /** /apps is admin-only — non-admins keep the single-path welcome. */
  showAppsPath: boolean;
}

/**
 * First screen of post-setup onboarding. For admins it forks into two paths:
 * install a catalog app in one click (/apps — the primary callout), or deploy
 * your own site via the existing repo → API key → GitHub Actions wizard. For
 * non-admin users (who cannot reach /apps) it keeps the single wizard path.
 *
 * The video is a click-to-load facade: on render it fetches only the static
 * thumbnail from i.ytimg.com, and the tracking-capable player iframe
 * (youtube-nocookie.com) is mounted only once the operator presses play. If
 * i.ytimg.com is blocked or unreachable — a self-hosted instance behind a
 * strict egress policy — onError drops the image and the gradient placeholder
 * plus play button remain, rather than a broken-image icon.
 */
export function WelcomeStep({ onNext, onSkip, onInstallApps, showAppsPath }: WelcomeStepProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [thumbnailFailed, setThumbnailFailed] = useState(false);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {showAppsPath
          ? 'Your instance is up and running. Install a ready-made app in one click, or deploy your own site — watch the walkthrough for a tour first if you like.'
          : 'Your instance is up and running. Watch the walkthrough, or jump straight in — the next few steps create your first repository, generate an API key, and hand you a GitHub Actions workflow to copy.'}
      </p>

      <div className="relative aspect-video overflow-hidden rounded-lg bg-gradient-to-br from-zinc-800 to-zinc-900">
        {isPlaying ? (
          <iframe
            className="absolute inset-0 h-full w-full"
            src={`https://www.youtube-nocookie.com/embed/${VIDEO_ID}?autoplay=1&rel=0`}
            title={VIDEO_TITLE}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        ) : (
          <button
            type="button"
            onClick={() => setIsPlaying(true)}
            aria-label={`Play video: ${VIDEO_TITLE}`}
            className="group absolute inset-0 h-full w-full"
          >
            {!thumbnailFailed && (
              <img
                src={thumbnailUrl}
                alt=""
                loading="lazy"
                onError={() => setThumbnailFailed(true)}
                className="absolute inset-0 h-full w-full object-cover"
              />
            )}
            {/* No caption overlay: YouTube thumbnails usually carry their own
                title art, and text on top of it collides. */}
            <span className="absolute inset-0 bg-black/20 transition-colors group-hover:bg-black/35" />
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#d96459] shadow-lg transition-transform group-hover:scale-110">
                <Play className="h-6 w-6 translate-x-[1px] fill-white text-white" />
              </span>
            </span>
          </button>
        )}
      </div>

      {showAppsPath ? (
        <>
          <div className="space-y-3">
            <div className="rounded-lg border-2 border-primary/50 bg-primary/5 p-4">
              <div className="flex items-start gap-3">
                <LayoutGrid className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div className="flex-1 space-y-2">
                  <h3 className="text-sm font-semibold">Install a ready-made app</h3>
                  <p className="text-sm text-muted-foreground">
                    Apps like Handoff install onto this instance in one click — frontend, backend
                    rules, and domain included.
                  </p>
                  <div className="flex items-center gap-3 pt-1">
                    <Button type="button" size="sm" onClick={onInstallApps}>
                      Browse apps
                    </Button>
                    <a
                      href={APP_STORE_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    >
                      See what's available ↗
                    </a>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-lg border p-4">
              <div className="flex items-start gap-3">
                <Rocket className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                <div className="flex-1 space-y-2">
                  <h3 className="text-sm font-semibold">Deploy your own site</h3>
                  <p className="text-sm text-muted-foreground">
                    Create a repository, generate an API key, and wire up a GitHub Actions deploy.
                  </p>
                  <div className="pt-1">
                    <Button type="button" variant="outline" size="sm" onClick={onNext}>
                      Create a repository
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <DocsLink href={DOCS_URL} label="Read the first-deployment guide" />

          <div className="pt-2">
            <Button type="button" variant="ghost" onClick={onSkip}>
              Skip for now
            </Button>
          </div>
        </>
      ) : (
        <>
          <DocsLink href={DOCS_URL} label="Read the first-deployment guide" />

          <div className="flex justify-between pt-4">
            <Button type="button" variant="ghost" onClick={onSkip}>
              Skip for now
            </Button>
            <Button type="button" onClick={onNext}>
              Get Started
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run the suite to verify it passes**

Run (from `apps/frontend`): `pnpm exec vitest run src/components/setup/onboarding/WelcomeStep.test.tsx`
Expected: PASS (8 tests). Note: `OnboardingModal.tsx` now has a TS error (missing new required props) — that's Task 2; confirm the WelcomeStep suite itself is green.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/lib/docsLinks.ts apps/frontend/src/components/setup/onboarding/WelcomeStep.tsx apps/frontend/src/components/setup/onboarding/WelcomeStep.test.tsx
git commit -m "feat(onboarding): two-path welcome — app-install callout for admins

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: OnboardingModal wiring — complete, close, navigate, role gate

**Files:**
- Modify: `apps/frontend/src/components/setup/onboarding/OnboardingModal.tsx`
- Test: `apps/frontend/src/components/setup/onboarding/OnboardingModal.test.tsx`

**Interfaces:**
- Consumes: Task 1's `WelcomeStep` props (`onInstallApps`, `showAppsPath`) and button labels (`Browse apps`, `Create a repository`, `Get Started`); `useGetSessionQuery` from `@/services/authApi`; `useNavigate` from `react-router-dom`; `completeOnboarding` from `@/store/slices/setupSlice`.
- Produces: nothing new outward — `OnboardingModalProps` unchanged. NOTE: `useNavigate` makes a Router ancestor mandatory; the modal is mounted from `HomePage` (inside the app Router), and tests must wrap in `MemoryRouter`.

- [ ] **Step 1: Write the failing tests**

Replace `apps/frontend/src/components/setup/onboarding/OnboardingModal.test.tsx` (existing two tests kept; `MemoryRouter` wrapper and an authApi mock added; two new tests):

```tsx
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { OnboardingModal } from './OnboardingModal';
import { api } from '@/services/api';
import setupReducer from '@/store/slices/setupSlice';

// This codebase has no MSW harness — RTK Query hooks are mocked directly, the
// same pattern the setup wizard tests use.
vi.mock('@/hooks/useBranding', () => ({
  useBranding: () => ({ siteName: 'BFFLESS' }),
}));

vi.mock('@/services/projectsApi', () => ({
  useCreateProjectMutation: () => [vi.fn(), { isLoading: false }],
}));

// Role drives whether the welcome step shows the apps path (/apps is admin-only).
const mockSession = vi.fn();
vi.mock('@/services/authApi', () => ({
  useGetSessionQuery: () => mockSession(),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => mockNavigate,
}));

function renderModal({ onClose = vi.fn() } = {}) {
  const store = configureStore({
    reducer: { setup: setupReducer, [api.reducerPath]: api.reducer },
    middleware: (getDefault) => getDefault().concat(api.middleware),
  });

  render(
    <Provider store={store}>
      <MemoryRouter>
        <OnboardingModal isOpen onClose={onClose} />
      </MemoryRouter>
    </Provider>
  );
  return { store, onClose };
}

describe('OnboardingModal', () => {
  beforeEach(() => {
    mockSession.mockReturnValue({ data: { user: { role: 'user' } } });
    mockNavigate.mockClear();
  });
  afterEach(cleanup);

  it('opens on the welcome step, not the repository form', () => {
    renderModal();

    expect(screen.getByText('Welcome to BFFLESS')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /first-deployment guide/i })).toBeInTheDocument();
    expect(screen.queryByLabelText('Repository Name')).toBeNull();
  });

  it('advances from welcome to the repository form', async () => {
    renderModal();

    await userEvent.click(screen.getByRole('button', { name: 'Get Started' }));

    expect(screen.getByText('Create Your First Repository')).toBeInTheDocument();
    expect(screen.getByLabelText('Repository Name')).toBeInTheDocument();
  });

  it('shows the apps path only to admins, and Browse apps completes + routes to /apps', async () => {
    mockSession.mockReturnValue({ data: { user: { role: 'admin' } } });
    const { store, onClose } = renderModal();

    await userEvent.click(screen.getByRole('button', { name: 'Browse apps' }));

    expect(store.getState().setup.onboarding.hasCompletedOnboarding).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/apps');
  });

  it('admins can still take the repository path', async () => {
    mockSession.mockReturnValue({ data: { user: { role: 'admin' } } });
    renderModal();

    await userEvent.click(screen.getByRole('button', { name: 'Create a repository' }));

    expect(screen.getByText('Create Your First Repository')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run (from `apps/frontend`): `pnpm exec vitest run src/components/setup/onboarding/OnboardingModal.test.tsx`
Expected: FAIL — the modal doesn't pass the new required props yet (TS/render error) and there is no `Browse apps` button.

- [ ] **Step 3: Wire the modal**

In `apps/frontend/src/components/setup/onboarding/OnboardingModal.tsx`:

```tsx
// added imports
import { useNavigate } from 'react-router-dom';
import { useGetSessionQuery } from '@/services/authApi';
```

Inside the component, after the existing selectors:

```tsx
  const navigate = useNavigate();
  const { data: sessionData } = useGetSessionQuery();
  // /apps is an admin-only route — only offer the apps path to admins.
  const showAppsPath = sessionData?.user?.role === 'admin';

  const handleInstallApps = () => {
    dispatch(completeOnboarding());
    onClose();
    navigate('/apps');
  };
```

And the step-1 case becomes:

```tsx
      case 1:
        return (
          <WelcomeStep
            onNext={handleNext}
            onSkip={handleSkip}
            onInstallApps={handleInstallApps}
            showAppsPath={showAppsPath}
          />
        );
```

- [ ] **Step 4: Run both suites to verify they pass**

Run (from `apps/frontend`): `pnpm exec vitest run src/components/setup/onboarding/`
Expected: PASS (12 tests across both files).

- [ ] **Step 5: Type-check and build**

Run (from the worktree root): `pnpm --filter frontend exec tsc --noEmit` then `pnpm build:frontend`
Expected: both clean. (Do NOT run repo-wide lint — it fails on `main` pre-existing.)

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/components/setup/onboarding/OnboardingModal.tsx apps/frontend/src/components/setup/onboarding/OnboardingModal.test.tsx
git commit -m "feat(onboarding): Browse apps completes onboarding and routes to /apps

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: PR

**Files:** none (operational)

**Interfaces:**
- Consumes: the two commits above, plus the spec/plan docs commits already on the branch.
- Produces: a PR to `bffless/ce`; the user merges (release-please ships it in the next CE release).

- [ ] **Step 1: Final verification sweep**

From `apps/frontend`: `pnpm exec vitest run src/components/setup/onboarding/` (12 passing) and `pnpm --filter frontend exec tsc --noEmit` (clean), run from a clean `git status` (only the intended files changed on the branch: `git diff --stat origin/main` shows exactly the 5 code/test files + 2 docs).

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin onboarding-apps-callout
gh pr create --repo bffless/ce --title "feat(onboarding): app-install callout as the primary first-login path" --body-file - <<'EOF'
## Summary
- First-login onboarding's welcome step now forks (admins only): a primary "Install a ready-made app" card that completes onboarding and routes to Admin → Apps (`/apps`), plus a small external link to the public store (https://apps.bffless.dev) — and a secondary "Deploy your own site" card continuing the existing repo → API key → GitHub Actions wizard unchanged.
- Non-admin users (who cannot reach the admin-only `/apps` route) keep the current single-path welcome, byte-for-byte.
- No changes to onboarding persistence, show conditions, or steps 2–4.

Design: docs/superpowers/specs/2026-08-01-onboarding-apps-callout-design.md

## Test plan
- WelcomeStep suite: 8 tests (both layouts, CTA wiring, store link target, video facade regressions)
- OnboardingModal suite: 4 tests (role gate, Browse apps → completeOnboarding + close + navigate('/apps'), both paths advance correctly)
- `tsc --noEmit` + frontend build clean

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

**PAUSE: the user reviews and merges the PR.** Do not merge it yourself.

---

## Self-Review Notes

- **Spec coverage:** two-path welcome → Task 1; CTA behavior (complete + close + navigate) → Task 2; role gate → Tasks 1–2; `APP_STORE_URL` constant → Task 1; testing section → Tasks 1–2 test steps; unchanged-surface guarantees → Global Constraints + Task 3's diff-stat check. Visual validation was spec'd as "if feasible" — a live backend on this VPS is heavy, so the plan gates on the component tests + typecheck + build instead, per the spec's fallback.
- **Type consistency:** `onInstallApps`/`showAppsPath` names and the `Browse apps`/`Create a repository`/`Get Started` labels match across Tasks 1 and 2; `APP_STORE_URL` import path `@/lib/docsLinks` consistent.
- **Test-mock note:** the react-router-dom partial mock keeps `MemoryRouter` real while stubbing `useNavigate` — required because Radix Dialog portals would otherwise make asserting on real navigation brittle.
