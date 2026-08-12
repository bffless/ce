# Server Video Ops Opt-In Flag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the ffmpeg handler's enable switch from a plain env read that defaults ON to a DB-overridable feature flag that defaults OFF, with an admin-settings toggle card — so server video ops are an explicit per-instance operator choice (on for a 2 GB bffless.dev, untouched-and-off for a 1 GB j5s.dev), never an inference from the environment.

**Architecture:** Add `FFMPEG_HANDLER_ENABLED` to `FLAG_DEFINITIONS` (default false, admin-only). `FfmpegCapabilityService` reads it through `FeatureFlagsService` (Database > file > env > default), making `isEnabled()`/`getOps()` async. The capability probe inherits the change with no payload-shape change; apps (Studio) need zero changes. A `VideoOpsSettings` card on Admin Settings → Infrastructure gives the post-install toggle, cloned from the `ProjectMembershipSettings` precedent.

**Tech Stack:** NestJS (feature-flags service exists), React admin frontend (shadcn Card/Switch, RTK Query featureFlagsApi exists), Jest/Vitest.

**Context:** Follow-up to CE v0.4.25's `ffmpeg_handler` (PR #654). Decided with the user 2026-08-12: policy must NOT couple to system memory — the per-job memory/disk pre-flights stay as the safety net, the flag is the policy. Opt-in default is deliberately flipped BEFORE the first consumer (the unmerged Studio PR) exists.

## Global Constraints

- Flag key AND envKey both exactly `FFMPEG_HANDLER_ENABLED` (bare envKey per the `BOT_PROTECTION_ENABLED` precedent at `feature-flags.definitions.ts:568-579`), `defaultValue: false`, `type: 'boolean'`, `category: 'features'`, NO `exposeToClient` (admin-only; apps learn capability from the probe, never from the flags endpoint).
- Resolution is the flag service's: **Database > file > env > default(false)**. `FFMPEG_HANDLER_ENABLED=true` in `.env` still enables (compose passthrough `${FFMPEG_HANDLER_ENABLED:-}` already exists and `''` counts as unset); an admin-UI toggle writes a DB override that beats env. Boolean env parsing becomes the flag service's strict `'true'|'1'|'yes'` — an intentional, disclosed semantics change from the old permissive parser.
- **No memory/viability coupling anywhere**: probe `server` = flag enabled && binary present. The per-job pre-flights (`FFMPEG_INSUFFICIENT_MEMORY` etc.) are untouched.
- Probe payload shape unchanged: `{ server, ops, version }`. The Studio contract is untouched.
- `readFfmpegEnv()`'s `enabled` field is REMOVED (its only consumer moves to the flag service); the sizing fields (`memoryMb`, `threads`, `queueMax`, `maxSeconds`, `scratchDir`) are untouched — verify no other consumer of `.enabled` exists (research: exactly one, `ffmpeg-capability.service.ts:54`).
- `FfmpegCapabilityService.isEnabled()` and `getOps()` become `async` (flag reads are async; DB-cached with 30 s TTL, in-process `setFlag` writes through immediately — no extra invalidation needed). Only callers: the handler's probe branch and gate (`ffmpeg.handler.ts:74-95`, already async context).
- The gate's error message drops the env-var phrasing; new message: `'server video ops are disabled on this instance (enable in Admin Settings → Infrastructure) or ffmpeg is missing'`.
- Frontend card follows `ProjectMembershipSettings.tsx` verbatim conventions (module-level FLAG_KEY, `useGetFeatureFlagQuery`/`useSetFeatureFlagMutation` with `.unwrap()` + toasts, Skeleton loading branch, destructive Alert error branch, `flex items-center justify-between rounded-lg border p-4` toggle row). Mounted in `InfrastructureTab.tsx` inside the existing `space-y-6` div. No component test (none exists for the precedent; local convention).
- Backend Jest: run focused from apps/backend (`pnpm test -- <pattern>`); full suite needs `NODE_OPTIONS=--max-old-space-size=4096`. The binary-gated integration suite must still pass with ffmpeg on PATH (`pnpm test:integration -- ffmpeg` — ffmpeg 7.0.2 static is at ~/.local/bin on this VPS).
- Commit after every task on branch `feat/server-video-ops-optin` (worktree `repos/ce/.claude/worktrees/ffmpeg-optin`). PR title (squash = release commit): `feat: server video ops become an opt-in admin setting`.

## File Structure

Modified (backend):
- `apps/backend/src/feature-flags/feature-flags.definitions.ts` (new entry at the tail, after BOT_PROTECTION_ENABLED)
- `apps/backend/src/feature-flags/feature-flags.definitions.spec.ts` (new describe block)
- `apps/backend/src/pipelines/ffmpeg/ffmpeg-env.ts` (+spec) — remove `enabled`
- `apps/backend/src/pipelines/ffmpeg/ffmpeg-capability.service.ts` (+spec) — inject flags, async isEnabled/getOps
- `apps/backend/src/pipelines/handlers/ffmpeg.handler.ts` (+spec) — await the capability calls, new gate message
- `apps/backend/src/pipelines/pipelines.module.ts` — import FeatureFlagsModule explicitly (local convention; it's @Global so this is documentation)
- `apps/backend/src/pipelines/__tests__/integration/ffmpeg.handler.spec.ts` — capability service constructor arg (fake flags returning true)
- `apps/backend/src/mcp/tools/proxy-rules.tools.ts` — one clause in the ffmpeg_handler prose
- `apps/backend/src/pipelines/execution/step-handler.interface.ts` — one TSDoc sentence

New (frontend):
- `apps/frontend/src/components/settings/VideoOpsSettings.tsx`

Modified (frontend/docs):
- `apps/frontend/src/pages/admin-settings/InfrastructureTab.tsx`
- `.env.example` (rewrite the default-ON sentences, lines ~529-553)

---

### Task 1: the flag definition + backend switch-over

One task because the definition and its consumer land together or the intermediate state is incoherent (a defined flag nobody reads, or a reader of an undefined flag).

**Files:**
- Modify: `apps/backend/src/feature-flags/feature-flags.definitions.ts` (append inside FLAG_DEFINITIONS, after the Bot Protection block ending ~line 579)
- Modify: `apps/backend/src/feature-flags/feature-flags.definitions.spec.ts`
- Modify: `apps/backend/src/pipelines/ffmpeg/ffmpeg-env.ts`, `ffmpeg-env.spec.ts`
- Modify: `apps/backend/src/pipelines/ffmpeg/ffmpeg-capability.service.ts`, `ffmpeg-capability.service.spec.ts`
- Modify: `apps/backend/src/pipelines/handlers/ffmpeg.handler.ts`, `ffmpeg.handler.spec.ts`
- Modify: `apps/backend/src/pipelines/pipelines.module.ts`
- Modify: `apps/backend/src/pipelines/__tests__/integration/ffmpeg.handler.spec.ts`

**Interfaces:**
- Produces: `FfmpegCapabilityService.isEnabled(): Promise<boolean>`; `getOps(): Promise<string[]>`; constructor `(featureFlags: FeatureFlagsService)`. Everything else on the service unchanged (`isAvailable()`, `getVersion()` stay sync).
- Consumes: `FeatureFlagsService.isEnabled(key)` (`feature-flags.service.ts:89-92`).

- [ ] **Step 1: Write/adjust the failing tests first**

`feature-flags.definitions.spec.ts` — copy the ENABLE_LOCAL_PRESIGNED_UPLOADS describe pattern (lines 14-23):

```ts
describe('FFMPEG_HANDLER_ENABLED', () => {
  it('is defined, OFF by default, and NOT exposed to the client', () => {
    const flag = FLAG_DEFINITIONS['FFMPEG_HANDLER_ENABLED'];
    expect(flag).toBeDefined();
    expect(flag.envKey).toBe('FFMPEG_HANDLER_ENABLED');
    expect(flag.defaultValue).toBe(false);
    expect(flag.type).toBe('boolean');
    expect(flag.category).toBe('features');
    expect(getClientExposedFlagKeys()).not.toContain('FFMPEG_HANDLER_ENABLED');
  });
});
```

`ffmpeg-env.spec.ts` — DELETE the `enabled` assertions (line 8's `cfg.enabled` expectation and the whole "only the literal string false disables" block, lines 25-29); the remaining spec pins only sizing fields.

`ffmpeg-capability.service.spec.ts` — rework around a fake flags service:

```ts
function fakeFlags(enabled: boolean) {
  return { isEnabled: jest.fn().mockResolvedValue(enabled) } as never;
}
```

- Every `new FfmpegCapabilityService()` gains the arg: `new FfmpegCapabilityService(fakeFlags(true))` (or false per case).
- The availability/probe tests keep their semantics (probe never throws, both binaries required) with `fakeFlags(true)`.
- REPLACE the env-only test (lines 56-66) with flag-semantics tests:

```ts
it('isEnabled is false when the flag is off, even with binaries present (opt-in default)', async () => {
  armExecFile(() => ({ stdout: 'ffmpeg version 6.0' }));
  const svc = new FfmpegCapabilityService(fakeFlags(false));
  await svc.probe();
  await expect(svc.isEnabled()).resolves.toBe(false);
  await expect(svc.getOps()).resolves.toEqual([]);
});

it('isEnabled is true only when flag on AND binaries present', async () => {
  armExecFile(() => ({ stdout: 'ffmpeg version 6.0' }));
  const svc = new FfmpegCapabilityService(fakeFlags(true));
  await svc.probe();
  await expect(svc.isEnabled()).resolves.toBe(true);
  await expect(svc.getOps()).resolves.toEqual(['probe', 'extract_audio', 'slice', 'concat']);
});

it('flag on but binaries missing stays false', async () => {
  const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  armExecFile(() => ({ error: enoent }));
  const svc = new FfmpegCapabilityService(fakeFlags(true));
  await svc.probe();
  await expect(svc.isEnabled()).resolves.toBe(false);
});
```

`ffmpeg.handler.spec.ts` — the createHandler capability mock's `isEnabled`/`getOps` become async-compatible (`jest.fn().mockResolvedValue(...)` or plain `async () =>` returns); assert the probe-disabled case still returns `success:true, server:false` and the gate case still returns `FFMPEG_UNAVAILABLE` with the NEW message wording (assert on a stable substring like `/disabled on this instance|ffmpeg is missing/`).

Integration spec — `new FfmpegCapabilityService({ isEnabled: async () => true } as never)` so the real-ffmpeg suite exercises the enabled path.

- [ ] **Step 2: Run to verify failure**

Run from apps/backend: `pnpm test -- 'feature-flags.definitions|pipelines/ffmpeg|handlers/ffmpeg'`
Expected: FAIL (missing definition; constructor arity; removed field still referenced).

- [ ] **Step 3: Implement**

`feature-flags.definitions.ts` (after the Bot Protection block, matching its banner style):

```ts
  // ==========================================================================
  // Server video ops (ffmpeg_handler) — opt-in per instance
  // ==========================================================================

  FFMPEG_HANDLER_ENABLED: {
    envKey: 'FFMPEG_HANDLER_ENABLED',
    defaultValue: false,
    type: 'boolean',
    description:
      'Run app video operations (slice, concat, audio extract, probe) server-side via the ffmpeg_handler pipeline step. ' +
      'Off by default: apps fall back to in-browser processing. Server video ops want the backend container at >= 1.5-2 GB memory; ' +
      'per-job memory/disk pre-flights refuse work that does not fit regardless of this flag. Toggle lives in Admin Settings → Infrastructure.',
    category: 'features',
  },
```

`ffmpeg-env.ts` — delete the `enabled` field from `FfmpegEnvConfig`, the `rawEnabled` logic from `readFfmpegEnv`, and (if now unused) any related imports. Leave every sizing field byte-identical.

`ffmpeg-capability.service.ts`:

```ts
import { FeatureFlagsService } from '../../feature-flags/feature-flags.service';

/** Flag key: DB > file > env > default-OFF (see FLAG_DEFINITIONS) — the operator's per-instance policy. */
export const SERVER_VIDEO_OPS_FLAG = 'FFMPEG_HANDLER_ENABLED';

  constructor(private readonly featureFlags: FeatureFlagsService) {}

  async isEnabled(): Promise<boolean> {
    return this.available && (await this.featureFlags.isEnabled(SERVER_VIDEO_OPS_FLAG));
  }

  async getOps(): Promise<string[]> {
    return (await this.isEnabled()) ? ['probe', 'extract_audio', 'slice', 'concat'] : [];
  }
```

(Follow `blocklist.service.ts:30,157,302` for the exported-const + injection idiom. Keep `isAvailable()`/`getVersion()` sync; keep `onModuleInit`'s test-env skip and `probe()` untouched.)

`ffmpeg.handler.ts` probe + gate (lines 74-95): `server: await this.capability.isEnabled()`, `ops: await this.capability.getOps()`, `if (!(await this.capability.isEnabled()))`, and the new message from Global Constraints. (One `isEnabled` call can be hoisted to a local to avoid three flag reads — fine either way, it's a 30s-cached map lookup.)

`pipelines.module.ts` — add `FeatureFlagsModule` to the imports array (matching `traffic.module.ts:24`'s explicit-import convention).

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test -- 'feature-flags.definitions|pipelines/ffmpeg|handlers/ffmpeg'` then `pnpm test:integration -- ffmpeg` (must RUN and pass against real ffmpeg) then `pnpm exec tsc --noEmit` and `pnpm exec eslint src/pipelines/ffmpeg/ src/pipelines/handlers/ffmpeg.handler.ts src/feature-flags/`.
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src
git commit -m "feat(pipelines): server video ops gate becomes an opt-in feature flag (default off)"
```

---

### Task 2: the Features tab — a curated, growable flag-toggle section

Decision (user, 2026-08-12): not a one-off card and not an auto-rendered all-flags page — a new **"Features" tab** in admin settings driven by a curated registry, so future operator-facing flags are one registry entry each, and sharp-edged flags (break-glass switches) never appear unless deliberately curated in.

**Files:**
- Create: `apps/frontend/src/components/settings/FeatureToggles.tsx` (registry + generic toggle rows + the card)
- Create: `apps/frontend/src/pages/admin-settings/FeaturesTab.tsx` (thin wrapper: `<div className="space-y-6"><FeatureToggles /></div>`)
- Modify: `apps/frontend/src/pages/AdminSettingsPage.tsx` (TABS entry: `{ value: 'features', path: '/admin/settings/features', label: 'Features', icon: ToggleRight }` — pick a fitting lucide icon; slot between General and Authentication or after Infrastructure, matching visual weight)
- Modify: `apps/frontend/src/App.tsx` (nested route `<Route path="features" element={<FeaturesTab />} />` beside the `infrastructure` route at ~:95)

**Interfaces:**
- Consumes: `useGetFeatureFlagQuery` / `useSetFeatureFlagMutation` (`featureFlagsApi.ts:51-73` — PUT body must include `{ key, value, enabled: true }`).
- Produces (the growth contract): a `FEATURE_TOGGLES` registry array; adding a future toggle = one new entry, zero new components.

- [ ] **Step 1: Implement**

```tsx
// apps/frontend/src/components/settings/FeatureToggles.tsx
// Curated, growable feature-toggle section (Admin Settings → Features).
// Each entry is a DB-backed feature flag (Database > env > default) rendered as a
// toggle row. Deliberately a registry, not an enumeration of all flags — flags
// appear here only when an operator-facing toggle is intentional.
import { Clapperboard, type LucideIcon } from 'lucide-react';

type FeatureToggle = {
  flagKey: string;
  icon: LucideIcon;
  title: string;
  description: string;        // row description under the label
  enabledToast: { title: string; description: string };
  disabledToast: { title: string; description: string };
};

const FEATURE_TOGGLES: FeatureToggle[] = [
  {
    flagKey: 'FFMPEG_HANDLER_ENABLED',
    icon: Clapperboard,
    title: 'Server video ops',
    description:
      'Apps that support it (e.g. Studio) slice, stitch, and extract audio via ffmpeg on this ' +
      'server — the video never leaves the bucket. Wants at least 1.5–2 GB of backend memory; ' +
      'jobs that do not fit are refused and apps fall back to in-browser processing. ' +
      'When off, apps always process in the browser.',
    enabledToast: {
      title: 'Server video ops enabled',
      description: 'Apps will use this server for video processing on their next session.',
    },
    disabledToast: {
      title: 'Server video ops disabled',
      description: 'Apps fall back to in-browser processing.',
    },
  },
];
```

Render one Card titled "Features" (`CardDescription`: 'Optional platform capabilities, stored per instance') containing one toggle row per registry entry. Each row is its own small component using EXACTLY `ProjectMembershipSettings.tsx`'s idioms per row: `useGetFeatureFlagQuery(flagKey)`, `const enabled = Boolean(flag?.value)`, `.unwrap()` + `'data' in err` narrowing + toasts, `<Switch checked={enabled} onCheckedChange={handleToggle} disabled={isUpdating} />`, a Skeleton row while loading, an inline destructive Alert per row on error. Row markup: the precedent's `flex items-center justify-between rounded-lg border p-4` with the icon + Label + description on the left.

Do NOT migrate `ProjectMembershipSettings` into the registry in this PR (it lives on the Auth tab with context-specific copy; migrating is a possible follow-up).

- [ ] **Step 2: Verify**

Run from apps/frontend: `pnpm exec tsc --noEmit && pnpm build`. Lint the new/changed files directly (`pnpm exec eslint src/components/settings/FeatureToggles.tsx src/pages/admin-settings/FeaturesTab.tsx src/pages/AdminSettingsPage.tsx src/App.tsx`) — repo-wide frontend lint fails on main (~58 pre-existing problems), don't chase those. Check `AdminSettingsPage.tsx`'s tab-detection logic (`pathAfterSettings.startsWith(...)` chain at ~:27-35) handles the new path — extend it the same way the `infrastructure` case is handled. No component test (precedent has none); if a routing/tab test exists for AdminSettingsPage (`pages/__tests__/AdminSettingsPage.test.tsx` exists — check it), extend it for the new tab.
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src
git commit -m "feat(frontend): curated Features tab in admin settings with server video ops toggle"
```

---

### Task 3: docs/prose + full verification

**Files:**
- Modify: `.env.example` (~lines 529-553)
- Modify: `apps/backend/src/mcp/tools/proxy-rules.tools.ts:70` (the ffmpeg_handler describe prose)
- Modify: `apps/backend/src/pipelines/execution/step-handler.interface.ts` (~line 676-697 TSDoc block)

- [ ] **Step 1: .env.example** — rewrite the two stale sentences. New text for the affected lines (keep the sizing/pre-flight sentences that follow):

```
# The ffmpeg_handler pipeline step runs video operations (slice, concat,
# audio extract, probe) server-side. It is OFF by default: enable it per
# instance in Admin Settings -> Infrastructure ("Server video ops"), or
# pre-seed it here (an admin-UI toggle stored in the database overrides
# this env value). ...
#
# Opt-in switch (default off). The admin-UI toggle overrides this.
# FFMPEG_HANDLER_ENABLED=true
```

- [ ] **Step 2: MCP prose** — append one clause to the ffmpeg_handler line's fallback sentence: `Server video ops are opt-in per instance (Admin Settings → Infrastructure); probe reports server:false until an admin enables them.`

- [ ] **Step 3: TSDoc** — add one sentence to the `FfmpegHandlerConfig` doc block: `Server video ops are an opt-in, instance-level admin setting (FFMPEG_HANDLER_ENABLED feature flag, default off); when off — or when ffmpeg is absent — probe reports server:false and every other operation returns FFMPEG_UNAVAILABLE.`

- [ ] **Step 4: Full verification** (from repo root):

```bash
NODE_OPTIONS=--max-old-space-size=4096 pnpm test
pnpm --filter backend exec tsc --noEmit && pnpm --filter frontend exec tsc --noEmit
cd apps/backend && pnpm test:integration -- ffmpeg
```

Expected: all green (baseline was green at 74c05fd).

- [ ] **Step 5: Commit**

```bash
git add .env.example apps/backend/src
git commit -m "docs: server video ops opt-in wording in env example, MCP prose, handler TSDoc"
```

---

## Out of scope / follow-ups

- Generic feature-flags admin page (deliberately not built — sharp-edged flags like the email-password break-glass shouldn't get a casual toggle).
- Per-project granularity (flag is instance-global by design).
- Studio-side changes: none needed. Merge order: this ships (patch release), j5s.dev updates → its probe returns server:false → the Studio PR becomes safe to merge; bffless.dev flips the toggle when ready.
- The dated design docs under docs/superpowers/ from PR #654 are historical records — not updated.

## Self-review notes

- Decision fidelity: flag ≠ memory (user requirement) — no viability coupling anywhere in this plan; pre-flights untouched.
- The only `.enabled` consumer is the capability service (research-verified exhaustively), so removing the env field is safe.
- Async ripple is bounded: two methods, one caller file, three spec files.
- Semantics change (permissive→strict env boolean parse) disclosed in Global Constraints and covered by the definitions-spec default assertion.
