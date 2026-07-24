# Primary SSL Cert-Rollback Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two gaps from [ce#511](https://github.com/bffless/ce/issues/511): give cert changes on direct serving (`proxyMode: 'none'`) the 5-minute auto-revert confirm window, and re-baseline the rollback snapshot on each new change cycle so "Restore previous SSL configuration" restores the most recent pre-change state (not the original pre-chain one).

**Architecture:** An `applied` marker file inside the existing `ssl-snapshot/` dir records that a cert-only apply committed without a confirm window; `snapshotForChangeCycle()` (replacing `snapshotIfAbsent()`) re-baselines over an applied snapshot. `apply()` classifies a change as needing the confirm window when it is a reachability change OR a cert-affecting change on direct serving, and reuses the existing pending-revert machinery (`PrimarySslRevertService` needs no changes). The frontend `ApplyPanel` branches its toast on `deadlineMs` presence instead of `kind`; `RollbackPanel` is untouched (already driven by `status.pendingRevert`).

**Tech Stack:** NestJS backend (Jest), React frontend (Vitest + Testing Library). Repo: `/home/rico/bffless/repos/ce`, branch `fix/primary-ssl-cert-rollback-hardening`.

**Spec:** `docs/superpowers/specs/2026-07-23-primary-ssl-cert-rollback-hardening-design.md`

## Global Constraints

- All paths below are relative to `/home/rico/bffless/repos/ce`.
- Run backend tests from `apps/backend` (`pnpm test -- <pattern>`), frontend from `apps/frontend` (`pnpm test -- <pattern>`).
- The response `kind` stays `'cert-only' | 'serving'`; `deadlineMs` presence is the confirm-required signal. Do NOT invent a new kind.
- `confirm()`, `rollback()`, `PrimarySslRevertService`, `RollbackPanel.tsx`, and `primarySslApi.ts` must NOT change.
- Match surrounding code style (compact, comment-dense where semantics are subtle).

---

### Task 1: Snapshot service — `applied` marker + `snapshotForChangeCycle()`

**Files:**
- Modify: `apps/backend/src/setup/primary-ssl/primary-ssl-snapshot.service.ts` (replace `snapshotIfAbsent`, lines 37–44; add marker methods)
- Modify: `apps/backend/src/setup/primary-ssl/primary-ssl.service.ts:83,111,156` (3 call sites: `snapshotIfAbsent()` → `snapshotForChangeCycle()`)
- Test: `apps/backend/src/setup/primary-ssl/primary-ssl-snapshot.service.spec.ts`
- Test: `apps/backend/src/setup/primary-ssl/primary-ssl.service.spec.ts` (mechanical rename in mock + assertions)

**Interfaces:**
- Produces: `PrimarySslSnapshotService.snapshotForChangeCycle(): void`, `markApplied(): void`, `isApplied(): boolean`. Task 2 relies on exactly these names.
- Behavior contract: `snapshotForChangeCycle()` snapshots when no snapshot exists OR the existing one is marked applied; otherwise no-op. `markApplied()` is a no-op when no snapshot exists. The marker is wiped by `snapshot()`, `restore()`, and `clearSnapshot()` (it lives inside the snapshot dir).

- [ ] **Step 1: Write the failing tests**

In `primary-ssl-snapshot.service.spec.ts`, rename the two `snapshotIfAbsent` tests (lines 35–49) to call `snapshotForChangeCycle` (same assertions, update the test names to say `snapshotForChangeCycle`), and add these three tests at the end of the describe block:

```ts
  it('markApplied/isApplied round-trip; markApplied without a snapshot is a no-op', () => {
    expect(svc.isApplied()).toBe(false);
    svc.markApplied(); // no snapshot yet — must not create the marker
    expect(svc.isApplied()).toBe(false);
    svc.snapshot();
    svc.markApplied();
    expect(svc.isApplied()).toBe(true);
  });

  it('snapshot(), clearSnapshot(), and restore() all clear the applied marker', () => {
    svc.snapshot(); svc.markApplied();
    svc.snapshot(); // fresh snapshot = new cycle
    expect(svc.isApplied()).toBe(false);
    svc.markApplied();
    svc.clearSnapshot();
    expect(svc.isApplied()).toBe(false);
    svc.snapshot(); svc.markApplied();
    svc.restore();
    expect(svc.isApplied()).toBe(false);
  });

  it('snapshotForChangeCycle re-baselines over an applied snapshot (rollback restores the LATEST pre-change bytes)', () => {
    // cycle 1: stage + cert-only apply of cert A over the original
    svc.snapshotForChangeCycle();               // baseline = ORIG
    fs.writeFileSync(path.join(sslDir, 'fullchain.pem'), 'CERT-A');
    svc.markApplied();                          // cert-only apply committed
    // cycle 2: staging cert B must re-baseline to A, not keep ORIG
    svc.snapshotForChangeCycle();
    expect(svc.isApplied()).toBe(false);
    fs.writeFileSync(path.join(sslDir, 'fullchain.pem'), 'CERT-B');
    svc.restore();
    expect(fs.readFileSync(path.join(sslDir, 'fullchain.pem'), 'utf8')).toBe('CERT-A');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/backend && pnpm test -- primary-ssl-snapshot`
Expected: FAIL — `svc.snapshotForChangeCycle is not a function` / `svc.markApplied is not a function`

- [ ] **Step 3: Implement in `primary-ssl-snapshot.service.ts`**

Replace the `snapshotIfAbsent` block (lines 37–44, comment included) with:

```ts
  // Safe entry point for cert-writing operations. The FIRST call in a change
  // cycle captures the last known-good (pre-change) state, and later calls in
  // the SAME cycle are no-ops so an apply after a stage/issue can't clobber
  // the good baseline with the staged cert. A snapshot left over from an
  // already-committed change (markApplied) is stale: re-baseline over it so
  // rollback targets the most recent pre-change state, not the pre-chain one.
  snapshotForChangeCycle(): void {
    if (!this.hasSnapshot() || this.isApplied()) this.snapshot();
  }

  private appliedMarkerPath(): string {
    return path.join(this.snapDir(), 'applied');
  }

  // Mark the current snapshot as belonging to an already-committed cert-only
  // change (one that got no confirm window). The marker lives inside the
  // snapshot dir, so snapshot()/restore()/clearSnapshot() wipe it with the
  // snapshot itself.
  markApplied(): void {
    if (this.hasSnapshot()) fs.writeFileSync(this.appliedMarkerPath(), '');
  }

  isApplied(): boolean {
    return fs.existsSync(this.appliedMarkerPath());
  }
```

- [ ] **Step 4: Update the 3 call sites in `primary-ssl.service.ts`**

At lines 83 (`stagePaste`), 111 (`issueLetsEncrypt`), and 156 (`apply`): change `this.snap.snapshotIfAbsent();` → `this.snap.snapshotForChangeCycle();`. Do not change surrounding comments' meaning — in the line-153 comment block above the `apply()` call site, replace the word `snapshotIfAbsent` if present and otherwise leave comments as-is.

- [ ] **Step 5: Mechanical rename in `primary-ssl.service.spec.ts`**

In the deps mock (line 19) rename `snapshotIfAbsent: jest.fn()` → `snapshotForChangeCycle: jest.fn()`, and update every `d.snap.snapshotIfAbsent` reference (lines 78–81, 115, 150, 171–173, 185) to `d.snap.snapshotForChangeCycle`.

- [ ] **Step 6: Run both suites + typecheck**

Run: `cd apps/backend && pnpm test -- primary-ssl && pnpm exec tsc --noEmit`
Expected: all primary-ssl* suites PASS, tsc clean.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/setup/primary-ssl/
git commit -m "refactor(ssl): snapshot change-cycle semantics — applied marker + re-baseline (ce#511 part 2)"
```

---

### Task 2: `apply()` classification — confirm window for direct-mode cert changes

**Files:**
- Modify: `apps/backend/src/setup/primary-ssl/primary-ssl.service.ts:151-164` (the tail of `apply()`)
- Test: `apps/backend/src/setup/primary-ssl/primary-ssl.service.spec.ts`

**Interfaces:**
- Consumes: `snap.snapshotForChangeCycle()`, `snap.markApplied()`, `snap.isApplied()`, `snap.hasSnapshot()` from Task 1.
- Produces: `apply()` returns `{ applied: true; kind: 'cert-only' | 'serving'; deadlineMs?: number }` where `deadlineMs` is now also set for cert-affecting changes when `next.proxyMode === 'none'`. Task 3's frontend branches on `deadlineMs != null`.

- [ ] **Step 1: Make the instance-config mock mutable**

In `primary-ssl.service.spec.ts`, replace the `jest.mock` block (lines 22–25) with:

```ts
let mockCur: any;
jest.mock('../../bootstrap/instance-config', () => ({
  loadInstanceConfig: () => mockCur,
  writeInstanceConfig: jest.fn(),
}));
```

and add a file-level `beforeEach` directly above the first `describe`:

```ts
beforeEach(() => {
  mockCur = { version: 2, state: 'applied', primaryDomain: 'a.com', proxyMode: 'none', sslMode: 'paste', port80: 'redirect', realIp: null };
});
```

Also extend the `snap` deps mock (line 19) with `isApplied: jest.fn().mockReturnValue(false), markApplied: jest.fn(),`.

- [ ] **Step 2: Write the failing tests**

Replace the `'cert-only change writes config, no pending revert'` test and add new ones, so the `PrimarySslService.apply classification` describe reads:

```ts
describe('PrimarySslService.apply classification', () => {
  it('cert-only change behind a proxy writes config with no pending revert, and marks the snapshot applied', async () => {
    const { d, svc } = build();
    mockCur.proxyMode = 'cloudflare';
    d.snap.hasSnapshot.mockReturnValue(true); // a cert was staged this cycle
    const r = await svc.apply({ proxyMode: 'cloudflare', sslMode: 'paste', port80: 'redirect', realIp: undefined } as any);
    expect(r.kind).toBe('cert-only');
    expect(r.deadlineMs).toBeUndefined();
    expect(d.snap.snapshotForChangeCycle).toHaveBeenCalled();
    expect(d.snap.writePendingRevert).not.toHaveBeenCalled();
    expect(d.snap.markApplied).toHaveBeenCalled();
  });

  it('cert change on direct serving gets the confirm window (pending revert + deadline, kind stays cert-only)', async () => {
    const { d, svc } = build();
    d.snap.hasSnapshot.mockReturnValue(true); // staged-but-unapplied cert in flight
    const r = await svc.apply({ proxyMode: 'none', sslMode: 'paste', port80: 'redirect', realIp: undefined } as any);
    expect(r.kind).toBe('cert-only');
    expect(typeof r.deadlineMs).toBe('number');
    expect(d.snap.writePendingRevert).toHaveBeenCalled();
    expect(d.snap.markApplied).not.toHaveBeenCalled();
    // classification must read the marker state BEFORE re-baselining can clear it
    expect(d.snap.isApplied.mock.invocationCallOrder[0]).toBeLessThan(d.snap.snapshotForChangeCycle.mock.invocationCallOrder[0]);
  });

  it('sslMode-only swap on direct serving gets the confirm window even with no staged files', async () => {
    const { d, svc } = build();
    d.snap.hasSnapshot.mockReturnValue(false);
    const r = await svc.apply({ proxyMode: 'none', sslMode: 'selfsigned', port80: 'redirect', realIp: undefined } as any);
    expect(r.kind).toBe('cert-only');
    expect(typeof r.deadlineMs).toBe('number');
    expect(d.snap.writePendingRevert).toHaveBeenCalled();
  });

  it('a stale applied snapshot does not trigger the confirm window on a no-op direct-mode apply', async () => {
    const { d, svc } = build();
    d.snap.hasSnapshot.mockReturnValue(true);
    d.snap.isApplied.mockReturnValue(true); // left over from a committed change
    const r = await svc.apply({ proxyMode: 'none', sslMode: 'paste', port80: 'redirect', realIp: undefined } as any);
    expect(r.deadlineMs).toBeUndefined();
    expect(d.snap.writePendingRevert).not.toHaveBeenCalled();
    expect(d.snap.markApplied).toHaveBeenCalled();
  });

  it('serving change writes a pending revert with a deadline and does not mark applied', async () => {
    process.env.SSL_SERVING_CONFIRM_TIMEOUT_MS = '1000';
    const { d, svc } = build();
    const r = await svc.apply({ proxyMode: 'cloudflare', sslMode: 'paste', port80: 'redirect', realIp: undefined } as any);
    expect(r.kind).toBe('serving');
    expect(d.snap.writePendingRevert).toHaveBeenCalled();
    expect(typeof r.deadlineMs).toBe('number');
    expect(d.snap.markApplied).not.toHaveBeenCalled();
    delete process.env.SSL_SERVING_CONFIRM_TIMEOUT_MS;
  });

  it('rejects a second apply while a revert is pending', async () => {
    const { d, svc } = build();
    d.snap.readPendingRevert.mockReturnValue({ deadlineMs: Date.now() + 1000, appliedAt: Date.now() });
    await expect(svc.apply({ proxyMode: 'none', sslMode: 'paste' } as any)).rejects.toThrow();
  });

  it('confirm clears the pending revert AND the snapshot; rollback restores', () => {
    const { d, svc } = build();
    svc.confirm();
    expect(d.snap.clearPendingRevert).toHaveBeenCalled();
    expect(d.snap.clearSnapshot).toHaveBeenCalled();
    svc.rollback();
    expect(d.snap.restore).toHaveBeenCalled();
  });
});
```

(The last two tests are the existing ones, kept verbatim apart from the reworded second-apply name.)

- [ ] **Step 3: Run tests to verify the new ones fail**

Run: `cd apps/backend && pnpm test -- primary-ssl.service`
Expected: FAIL — direct-mode cert tests get `deadlineMs: undefined`; proxied test fails on `markApplied` not called.

- [ ] **Step 4: Implement the classification in `apply()`**

In `primary-ssl.service.ts`, replace lines 151–164 (from `const serving = ...` through the final `return`) with:

```ts
    const serving = this.isReachabilityChange(cur, next);
    // A cert is "in flight" when a stage/issue snapshotted this cycle and no
    // apply has committed it yet. An sslMode switch also changes the served
    // cert (e.g. paste -> selfsigned) even with no newly staged files.
    const certAffecting =
      (this.snap.hasSnapshot() && !this.snap.isApplied()) || cur.sslMode !== next.sslMode;
    // On direct serving (nginx terminates TLS) a bad cert breaks the browser
    // on admin.<domain> — the page hosting the rollback button — so cert
    // changes there get the same provisional confirm window as reachability
    // changes. Behind Cloudflare/proxy the origin cert isn't user-facing, so
    // those stay manual-rollback-only (ce#511).
    const needsConfirm = serving || (certAffecting && next.proxyMode === 'none');

    // Reuse the snapshot taken by a prior stage/issue (which holds the OLD
    // cert); re-baseline over a stale applied one; otherwise snapshot the
    // current known-good state.
    this.snap.snapshotForChangeCycle();
    writeInstanceConfig(next); // watcher re-renders main.conf + reloads (~3s); no restart

    if (needsConfirm) {
      const deadlineMs = Date.now() + this.confirmTimeoutMs();
      this.snap.writePendingRevert({ deadlineMs, appliedAt: Date.now() });
      return { applied: true, kind: serving ? 'serving' : 'cert-only', deadlineMs };
    }
    // Committed without a confirm window: mark the snapshot applied so the
    // next change cycle re-baselines instead of rolling back past this change.
    this.snap.markApplied();
    return { applied: true, kind: 'cert-only' };
```

- [ ] **Step 5: Run tests + typecheck**

Run: `cd apps/backend && pnpm test -- primary-ssl && pnpm exec tsc --noEmit`
Expected: all primary-ssl* suites PASS (including revert service — unchanged, its pending-revert→restore path now also covers cert confirm windows), tsc clean.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/setup/primary-ssl/
git commit -m "fix(ssl): auto-revert window for cert changes on direct serving (ce#511 part 1)"
```

---

### Task 3: Frontend — ApplyPanel branches on `deadlineMs`

**Files:**
- Modify: `apps/frontend/src/components/settings/primary-ssl/ApplyPanel.tsx:19-27`
- Test: `apps/frontend/src/components/settings/primary-ssl/__tests__/ApplyPanel.test.tsx`

**Interfaces:**
- Consumes: apply response `{ applied: true, kind: 'cert-only' | 'serving', deadlineMs?: number }` (Task 2). No API-type changes — `primarySslApi.ts` already declares `deadlineMs?`.

- [ ] **Step 1: Write the failing test**

Add to `ApplyPanel.test.tsx` after the `'shows the countdown-started notice for a serving result'` test:

```tsx
  it('shows the countdown-started notice with cert copy for a cert-only result carrying a deadline', async () => {
    apply.mockReturnValue({
      unwrap: () => Promise.resolve({ applied: true, kind: 'cert-only', deadlineMs: Date.now() + 60000 }),
    });
    render(<ApplyPanel config={config} disabled={false} />);

    fireEvent.click(screen.getByRole('button', { name: /apply changes/i }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Applied — confirmation required',
          description: expect.stringContaining('new certificate'),
        }),
      ),
    );
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && pnpm test -- ApplyPanel`
Expected: FAIL — the new test receives the plain `'Applied'` toast.

- [ ] **Step 3: Implement**

In `ApplyPanel.tsx`, replace the `if (result.kind === 'serving') { ... } else { ... }` block (lines 19–27) with:

```tsx
      if (result.deadlineMs != null) {
        toast({
          title: 'Applied — confirmation required',
          description:
            result.kind === 'serving'
              ? 'A confirmation countdown has started. Reachability may change; confirm below once you’ve verified the site loads, or it will auto-revert.'
              : 'A confirmation countdown has started. Verify the site loads with the new certificate, then confirm below — or it will auto-revert.',
        });
      } else {
        toast({ title: 'Applied', description: 'Certificate updated successfully.' });
      }
```

- [ ] **Step 4: Run tests + typecheck**

Run: `cd apps/frontend && pnpm test -- ApplyPanel && pnpm exec tsc --noEmit`
Expected: all 6 ApplyPanel tests PASS (existing serving test still passes — it sends `deadlineMs`; existing cert-only test sends none), tsc clean.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/settings/primary-ssl/
git commit -m "fix(ssl): confirm-required toast keys off deadlineMs, with cert-specific copy (ce#511)"
```

---

### Task 4: Full verification, spec/plan commit, PR

**Files:**
- Commit: `docs/superpowers/specs/2026-07-23-primary-ssl-cert-rollback-hardening-design.md`, `docs/superpowers/plans/2026-07-23-primary-ssl-cert-rollback-hardening.md`

- [ ] **Step 1: Full backend + frontend suites**

Run: `cd apps/backend && pnpm test` then `cd ../frontend && pnpm test`
Expected: PASS (pre-existing failures unrelated to primary-ssl, if any, must be reported — not silently accepted).

- [ ] **Step 2: Commit the spec + plan**

```bash
git add docs/superpowers/
git commit -m "docs: spec + plan for primary SSL cert-rollback hardening (ce#511)"
```

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin fix/primary-ssl-cert-rollback-hardening
gh pr create --repo bffless/ce --title "fix(ssl): cert-change confirm window on direct serving + snapshot re-baselining" --body "Closes #511.

- Cert-affecting applies on \`proxyMode: 'none'\` now get the 5-minute provisional auto-revert window (a wrong cert on admin.<domain> heals itself instead of locking you out).
- The rollback snapshot re-baselines each change cycle via an \`applied\` marker, so 'Restore previous SSL configuration' restores the most recent pre-change cert instead of overshooting to the pre-chain one.
- Behind Cloudflare/proxy, cert changes stay manual-rollback-only (origin cert isn't user-facing).
- Frontend: ApplyPanel toast keys off \`deadlineMs\`; RollbackPanel unchanged (already driven by \`status.pendingRevert\`).

Spec: \`docs/superpowers/specs/2026-07-23-primary-ssl-cert-rollback-hardening-design.md\`

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Expected: PR URL printed; PR body references `Closes #511`.
