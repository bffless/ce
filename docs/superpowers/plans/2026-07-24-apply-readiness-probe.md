# Apply Readiness Probe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the bootstrap wizard's post-apply redirect fire only when the restarted backend is actually ready, instead of on nginx's 502.

**Architecture:** A new public `GET /api/setup/ready` endpoint answers 200 + `Access-Control-Allow-Origin: *` once Nest is fully booted (migrations/SuperTokens/nginx regen all precede `listen`). `ApplyStep.tsx` swaps its `no-cors` reachability probe (which resolves on nginx's 502 while the backend is dead) for a plain `cors` fetch of that endpoint, redirecting only on `res.ok`.

**Tech Stack:** NestJS controller (backend, Jest), React + RTK (frontend, Vitest).

**Spec:** `docs/superpowers/specs/2026-07-24-apply-readiness-probe-design.md`

## Global Constraints

- Branch: `specs/do-one-click-and-web-bootstrap`, worktree `.claude/worktrees/bootstrap-apply-readiness`.
- Workspace rule: commits require the user's explicit sign-off — complete each task's code + tests, but hold the commit steps until sign-off is given.
- ACAO header value must be exactly `*`; probe fetch must NOT send credentials (use fetch defaults — no `credentials: 'include'`).
- Response body is exactly `{ ready: true }` — no setup-state details (that is why `status`'s CORS is not widened instead).

---

### Task 1: Backend `GET /api/setup/ready`

**Files:**
- Modify: `apps/backend/src/setup/setup.controller.ts` (imports at :1-15, new handler after `getStatus` at :85)
- Test: `apps/backend/src/setup/setup.controller.spec.ts`

**Interfaces:**
- Produces: `GET /api/setup/ready` → 200 `{ ready: true }`, headers `Access-Control-Allow-Origin: *` and `Cache-Control: no-store`. Task 2 polls this route.

- [ ] **Step 1: Write the failing test**

Append inside the top-level `describe('SetupController', ...)` block of `apps/backend/src/setup/setup.controller.spec.ts` (after the `initialize` describe):

```ts
describe('getReady', () => {
  it('returns ready with wide-open CORS and no-store caching', () => {
    const res = { setHeader: jest.fn() };

    const result = controller.getReady(res as any);

    expect(result).toEqual({ ready: true });
    expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && pnpm jest src/setup/setup.controller.spec.ts`
Expected: FAIL — `controller.getReady is not a function`

- [ ] **Step 3: Write minimal implementation**

In `apps/backend/src/setup/setup.controller.ts`:

Add `Res` to the `@nestjs/common` import list (line 1-13) and widen the express import (line 15):

```ts
import { Request, Response } from 'express';
```

Insert after the `getStatus` handler (after line 85):

```ts
@Get('ready')
@ApiOperation({
  summary: 'Readiness probe',
  description:
    'Answers 200 once the backend is fully booted. Served with Access-Control-Allow-Origin: * so ' +
    'the bootstrap wizard can poll it from any origin (including a bare-IP page) across the apply ' +
    'restart. Public; exposes nothing beyond process liveness.',
})
@ApiResponse({ status: 200, description: 'Backend is up and serving requests' })
getReady(@Res({ passthrough: true }) res: Response): { ready: boolean } {
  // Overwrites the header the global CORS middleware set from its origin
  // allowlist: this endpoint carries no credentials and nothing beyond
  // "the process is up", so any origin may read it — that is what lets the
  // wizard's post-apply poll work from the bare-IP page. no-store keeps
  // any layer from replaying a stale "ready" mid-restart.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  return { ready: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && pnpm jest src/setup/setup.controller.spec.ts`
Expected: PASS (4 tests)

Then type-check: `pnpm --filter backend exec tsc --noEmit` → no errors.

- [ ] **Step 5: Commit (HOLD until user sign-off)**

```bash
git add apps/backend/src/setup/setup.controller.ts apps/backend/src/setup/setup.controller.spec.ts
git commit -m "feat(setup): CORS-open /api/setup/ready readiness probe"
```

---

### Task 2: `ApplyStep` polls readiness instead of reachability

**Files:**
- Modify: `apps/frontend/src/components/setup/ApplyStep.tsx:82-106` (poll body)
- Test: `apps/frontend/src/components/setup/__tests__/ApplyStep.test.tsx`

**Interfaces:**
- Consumes: `GET ${adminUrl}/api/setup/ready` from Task 1 — readable 200 `{ready:true}` cross-origin; nginx's 502 (backend down) has no ACAO header, so a cross-origin fetch throws and a same-origin fetch reads `ok: false`.

- [ ] **Step 1: Update the poll test + add the 502 regression test (failing first)**

In `apps/frontend/src/components/setup/__tests__/ApplyStep.test.tsx`:

Replace the body of `it('polls the new origin, keeps polling while unreachable, and redirects once it responds', ...)` (lines 265-306) with:

```ts
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.fn();
    // First poll: rejects (network/DNS not ready, or cross-origin 502 whose
    // missing ACAO header makes the read throw). Second poll: reachable but
    // not ready (same-origin nginx 502 → readable !ok) — must NOT redirect.
    // Third poll: backend up (readable 200) — redirect.
    fetchMock.mockRejectedValueOnce(new Error('network error'));
    fetchMock.mockResolvedValueOnce({ ok: false });
    fetchMock.mockResolvedValueOnce({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    renderWithStore(<ApplyStep />, {
      bootstrapDomain: 'example.com',
      servingMode: 'cloudflare',
      bootstrapSslMode: 'paste',
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /finish setup/i }));

    await waitFor(() => expect(screen.getByText(/switching to/i)).toBeInTheDocument());

    // First poll tick: fetch rejects, no redirect yet.
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('https://admin.example.com/api/setup/ready');
    expect(window.location.href).toBe('https://old-origin.example/setup');

    // Second poll tick: reachable 502 (ok:false) — still no redirect. This is
    // the ~20s restart window where nginx is up but the backend is dead; the
    // old no-cors probe redirected here (opaque responses resolve on 502).
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(window.location.href).toBe('https://old-origin.example/setup');

    // Third poll tick: ready — redirect happens.
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(window.location.href).toBe('https://admin.example.com');

    // No further polling after a successful redirect.
    await vi.advanceTimersByTimeAsync(9000);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // The redirect-once guard doesn't break the happy path: exactly one
    // assignment, not zero and not more than one.
    expect(hrefAssignments).toEqual(['https://admin.example.com']);
```

(The test name becomes `'polls readiness on the new origin, ignores not-ready answers, and redirects once ready'`.)

In `it('guards against overlapping poll resolutions producing more than one redirect', ...)` change the two resolutions (lines 416-417) to ready responses:

```ts
    resolveFirst({ ok: true });
    resolveSecond({ ok: true });
```

The unmount, hint, and manual-link tests need no changes (rejected fetches behave the same).

- [ ] **Step 2: Run tests to verify the updated ones fail**

Run: `cd apps/frontend && pnpm vitest run src/components/setup/__tests__/ApplyStep.test.tsx`
Expected: FAIL — the poll test asserts URL `/api/setup/ready` (component still calls `/api/setup/status` with `{ mode: 'no-cors' }`) and asserts no redirect on `{ ok: false }` (component redirects on any resolution). Overlap test fails on the URL-argument change only if asserted; primarily the poll test fails.

- [ ] **Step 3: Update the poll implementation**

In `apps/frontend/src/components/setup/ApplyStep.tsx`, replace the `try { ... } catch { ... }` block inside the interval callback (lines 84-101) with:

```ts
      try {
        // Readiness probe. Reachability alone is a FALSE signal here: nginx
        // (separate container) never goes down during the apply restart and
        // answers 502 while the backend is dead — and an opaque no-cors fetch
        // resolves on that 502, which used to redirect ~17s early into an
        // "invalid credentials" login. /api/setup/ready replies with
        // Access-Control-Allow-Origin: *, so this plain fetch is readable
        // from ANY origin (bare-IP page included) and res.ok only goes true
        // once the backend is genuinely up (Nest listens only after full
        // bootstrap, so login works). While it isn't: cross-origin the 502
        // lacks the ACAO header and the fetch throws; same-origin it reads
        // as !ok. Either way we keep polling.
        const res = await fetch(`${adminUrl}/api/setup/ready`);
        if (res.ok) {
          if (doneRef.current) return;
          doneRef.current = true;
          if (pollRef.current) clearInterval(pollRef.current);
          window.location.href = adminUrl;
          return;
        }
      } catch {
        /* backend still restarting / DNS still propagating — keep polling */
      }
```

(The lines before/after — `if (doneRef.current) return;` at the top of the callback and the `elapsedMs` hint accounting — stay exactly as they are; a not-ready `res.ok === false` now falls through to the hint accounting.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/frontend && pnpm vitest run src/components/setup/__tests__/ApplyStep.test.tsx`
Expected: PASS (17 tests)

Then type-check: `pnpm --filter frontend exec tsc --noEmit` → no errors.

- [ ] **Step 5: Commit (HOLD until user sign-off)**

```bash
git add apps/frontend/src/components/setup/ApplyStep.tsx apps/frontend/src/components/setup/__tests__/ApplyStep.test.tsx docs/superpowers/specs/2026-07-24-apply-readiness-probe-design.md docs/superpowers/plans/2026-07-24-apply-readiness-probe.md
git commit -m "fix(bootstrap): redirect after apply only when the backend is ready, not on nginx's 502"
```
