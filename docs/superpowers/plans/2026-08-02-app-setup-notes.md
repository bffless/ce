# App Setup Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn an app manifest's `install.manualSteps` from a one-shot checklist of unreadable paragraphs into short, deep-linked notes that live permanently on the installed app's card.

**Architecture:** Three independent moves. The backend loses the acknowledgement mechanism entirely (endpoint, DTO, service method, DB column) and gains two things: `{projectPath}`/`{appHost}` placeholder interpolation so a manifest can link into the dashboard it doesn't know the shape of, and a live re-derivation of the synthesized TLS note so it survives past the install dialog. The frontend extracts one `SetupNotes` component rendered in two places — collapsed on the installed card (its permanent home) and expanded on the install dialog's Done screen. A separate repo, `bffless/apps`, carries the rewritten manifest copy and a lint rule that keeps future copy short.

**Tech Stack:** NestJS + Drizzle + Jest (CE backend), React 18 + RTK Query + Vitest + Testing Library (CE frontend), plain ESM + `node:test` (apps repo scripts).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-02-app-setup-notes-design.md`.
- **Copy rule:** a note's title is the action; its body is at most **220 characters**. A note that needs a conditional to decide whether it applies to the reader belongs in the app's README, not the manifest.
- **Placeholders are a closed set:** `{projectPath}` and `{appHost}`. Any other `{token}` is a manifest validation error.
- The `manualSteps` manifest key keeps its name — renaming it would break `schemaVersion: 1` for manifests already published to the registry.
- Two repos, two PRs: `/home/rico/bffless/repos/ce/.claude/worktrees/app-setup-notes` (branch `spec/app-setup-notes`) and `/home/rico/bffless/repos/apps` (needs its own branch, Task 7).
- CE backend tests: `cd apps/backend && npx jest <path>`. CE frontend tests: `cd apps/frontend && npx vitest run <path>`.
- Never run `pnpm db:generate` — it is interactive. Task 4 hands the command to the operator and stops.

---

### Task 1: Placeholder interpolation

The pure function every later backend task depends on. Expands `{projectPath}` and `{appHost}` in a manual step's `title`, `body` and `deepLink`.

**Files:**
- Modify: `apps/backend/src/app-catalog/app-manifest.util.ts` (append at end of file)
- Test: `apps/backend/src/app-catalog/app-manifest.util.spec.ts` (append at end of file)

**Interfaces:**
- Consumes: `AppManualStep` from `./app-manifest.types` (already imported at the top of the util).
- Produces:
  ```ts
  export interface StepPlaceholders {
    projectPath?: string;
    appHost?: string;
  }
  export function interpolateStep(step: AppManualStep, values: StepPlaceholders): AppManualStep
  export const PLACEHOLDER_TOKENS: readonly string[]  // ['projectPath', 'appHost']
  ```
  Tasks 2, 3 and 5 call `interpolateStep`. Task 6 uses `PLACEHOLDER_TOKENS` for validation.

- [ ] **Step 1: Write the failing test**

Append to `apps/backend/src/app-catalog/app-manifest.util.spec.ts`:

```ts
describe('interpolateStep', () => {
  const step = {
    id: 'grant-access',
    title: 'Give other people access',
    body: 'Add each person as a guest on {projectPath}.',
    deepLink: '/repo/{projectPath}/settings?tab=members',
  };

  it('expands every token across title, body and deepLink', () => {
    const result = interpolateStep(
      { ...step, title: 'Access for {projectPath}' },
      { projectPath: 'acme/site', appHost: 'reader.example.com' },
    );

    expect(result.title).toBe('Access for acme/site');
    expect(result.body).toBe('Add each person as a guest on acme/site.');
    expect(result.deepLink).toBe('/repo/acme/site/settings?tab=members');
  });

  it('expands every occurrence of a repeated token', () => {
    const result = interpolateStep(
      { id: 'x', title: 't', body: 'Allow PUT from {appHost} to {appHost}.' },
      { appHost: 'a.example.com' },
    );

    expect(result.body).toBe('Allow PUT from a.example.com to a.example.com.');
  });

  it('leaves a step with no tokens untouched', () => {
    const plain = { id: 'x', title: 'Title', body: 'Body.', deepLink: '/domains' };

    expect(interpolateStep(plain, { projectPath: 'acme/site' })).toEqual(plain);
  });

  it('drops a sentence whose token has no value rather than emitting a literal brace', () => {
    const result = interpolateStep(
      { id: 'x', title: 'T', body: 'First sentence. Allow PUT from {appHost}. Last sentence.' },
      {},
    );

    expect(result.body).toBe('First sentence. Last sentence.');
    expect(result.body).not.toContain('{appHost}');
  });

  it('omits deepLink entirely when it depends on a token with no value', () => {
    const result = interpolateStep(
      { id: 'x', title: 'T', body: 'B', deepLink: '/repo/{projectPath}/settings' },
      {},
    );

    expect(result.deepLink).toBeUndefined();
  });

  it('does not mutate the input step', () => {
    const original = { id: 'x', title: 'T', body: 'On {projectPath}.' };
    interpolateStep(original, { projectPath: 'acme/site' });

    expect(original.body).toBe('On {projectPath}.');
  });
});
```

Add `interpolateStep` to the existing import at the top of the spec file, which currently reads:

```ts
import { validateAppManifest, validateRegistry, manualStepApplies } from './app-manifest.util';
```

so that it becomes:

```ts
import {
  validateAppManifest,
  validateRegistry,
  manualStepApplies,
  interpolateStep,
} from './app-manifest.util';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && npx jest src/app-catalog/app-manifest.util.spec.ts -t interpolateStep`
Expected: FAIL — TypeScript cannot resolve `interpolateStep` from `./app-manifest.util`.

- [ ] **Step 3: Write minimal implementation**

Append to `apps/backend/src/app-catalog/app-manifest.util.ts`:

```ts
/** The closed set of tokens a manifest may use in a manual step. */
export const PLACEHOLDER_TOKENS = ['projectPath', 'appHost'] as const;

export type PlaceholderToken = (typeof PLACEHOLDER_TOKENS)[number];

export type StepPlaceholders = Partial<Record<PlaceholderToken, string>>;

/** Matches `{projectPath}` / `{appHost}` and nothing else — validation rejects other tokens. */
const TOKEN_RE = new RegExp(`\\{(${PLACEHOLDER_TOKENS.join('|')})\\}`, 'g');

/**
 * A sentence whose token has no value (an app installed before it had a
 * domain has no `{appHost}`) is dropped whole rather than rendered with a
 * literal brace or a hole where the host should be. Sentence = run of text up
 * to and including its terminating period + following space.
 */
function expand(text: string, values: StepPlaceholders): string {
  const sentences = text.match(/[^.]*\.\s*|[^.]+$/g) ?? [text];

  return sentences
    .filter((sentence) => {
      const tokens = [...sentence.matchAll(TOKEN_RE)].map((m) => m[1] as PlaceholderToken);
      return tokens.every((token) => values[token] !== undefined);
    })
    .join('')
    .replace(TOKEN_RE, (_match, token: PlaceholderToken) => values[token] as string)
    .trim();
}

/**
 * Expands `{projectPath}`/`{appHost}` in a manual step. A manifest cannot
 * hardcode `/repo/acme/site/settings?tab=members` — it does not know which
 * project it will be installed into — so it declares the token and CE fills
 * it in at read time. Returns a new step; never mutates the input.
 */
export function interpolateStep(step: AppManualStep, values: StepPlaceholders): AppManualStep {
  const result: AppManualStep = {
    ...step,
    title: expand(step.title, values),
    body: expand(step.body, values),
  };

  if (step.deepLink !== undefined) {
    const tokens = [...step.deepLink.matchAll(TOKEN_RE)].map((m) => m[1] as PlaceholderToken);
    // A link to a page we can't name is worse than no link.
    if (tokens.every((token) => values[token] !== undefined)) {
      result.deepLink = step.deepLink.replace(
        TOKEN_RE,
        (_match, token: PlaceholderToken) => values[token] as string,
      );
    } else {
      delete result.deepLink;
    }
  }

  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && npx jest src/app-catalog/app-manifest.util.spec.ts`
Expected: PASS — the six new `interpolateStep` cases plus every pre-existing case in the file.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/app-catalog/app-manifest.util.ts apps/backend/src/app-catalog/app-manifest.util.spec.ts
git commit -m "feat(app-catalog): interpolate {projectPath}/{appHost} in manual steps"
```

---

### Task 2: Reject unknown placeholder tokens at validation

A typo like `{projectpath}` must fail the manifest rather than ship a literal brace to a user.

**Files:**
- Modify: `apps/backend/src/app-catalog/app-manifest.util.ts` (inside `validateManualSteps`, which starts at line 151)
- Test: `apps/backend/src/app-catalog/app-manifest.util.spec.ts`

**Interfaces:**
- Consumes: `PLACEHOLDER_TOKENS` from Task 1.
- Produces: no new exports. `validateAppManifest` gains errors of the form `install.manualSteps[0].body: unknown placeholder {foo} (known: projectPath, appHost)`.

- [ ] **Step 1: Write the failing test**

Append inside the existing top-level `describe` that holds the other `validateAppManifest` cases in `apps/backend/src/app-catalog/app-manifest.util.spec.ts`. Model the fixture on the neighbouring test at line 97 (`'fails when a manualSteps entry has an appliesWhen outside the closed enum…'`) — reuse whatever base-manifest helper that test uses:

```ts
it('fails when a manual step body uses an unknown placeholder, naming the known ones', () => {
  const result = validateAppManifest({
    ...baseManifest,
    install: {
      ...baseManifest.install,
      manualSteps: [{ id: 'x', title: 'Title', body: 'Go to {foo} now.' }],
    },
  });

  const err = result.errors.find((e) => e.startsWith('install.manualSteps[0].body:'));
  expect(err).toContain('unknown placeholder {foo}');
  expect(err).toContain('projectPath, appHost');
});

it('fails when a manual step deepLink uses an unknown placeholder', () => {
  const result = validateAppManifest({
    ...baseManifest,
    install: {
      ...baseManifest.install,
      manualSteps: [{ id: 'x', title: 'T', body: 'B', deepLink: '/repo/{owner}/settings' }],
    },
  });

  expect(result.errors.some((e) => e.includes('unknown placeholder {owner}'))).toBe(true);
});

it('accepts the known placeholders', () => {
  const result = validateAppManifest({
    ...baseManifest,
    install: {
      ...baseManifest.install,
      manualSteps: [
        {
          id: 'x',
          title: 'T',
          body: 'Allow PUT from {appHost}.',
          deepLink: '/repo/{projectPath}/settings?tab=members',
        },
      ],
    },
  });

  expect(result.errors.filter((e) => e.includes('placeholder'))).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && npx jest src/app-catalog/app-manifest.util.spec.ts -t placeholder`
Expected: FAIL — the first two cases find no matching error (`err` is `undefined`), because nothing checks tokens yet.

- [ ] **Step 3: Write minimal implementation**

In `apps/backend/src/app-catalog/app-manifest.util.ts`, add this helper directly above `validateManualSteps` (line 151):

```ts
/** Any `{token}` at all, so unknown ones can be named in the error. */
const ANY_TOKEN_RE = /\{([^}]*)\}/g;

function validateStepPlaceholders(
  value: unknown,
  fieldPath: string,
  errors: string[],
): void {
  if (typeof value !== 'string') return;

  for (const match of value.matchAll(ANY_TOKEN_RE)) {
    const token = match[1];
    if (!(PLACEHOLDER_TOKENS as readonly string[]).includes(token)) {
      errors.push(
        `${fieldPath}: unknown placeholder {${token}} (known: ${PLACEHOLDER_TOKENS.join(', ')})`,
      );
    }
  }
}
```

Then, inside `validateManualSteps`'s `manualSteps.forEach((entry, i) => { … })` body, after the existing `title`/`body`/`deepLink` type checks and before the `appliesWhen` check, add:

```ts
    validateStepPlaceholders(entry.title, `${entryPath}.title`, errors);
    validateStepPlaceholders(entry.body, `${entryPath}.body`, errors);
    validateStepPlaceholders(entry.deepLink, `${entryPath}.deepLink`, errors);
```

`PLACEHOLDER_TOKENS` is declared later in the file than `validateManualSteps`, which is fine — `const` at module scope is initialised before `validateAppManifest` is ever called.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && npx jest src/app-catalog/app-manifest.util.spec.ts`
Expected: PASS — all cases, including the pre-existing ones.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/app-catalog/app-manifest.util.ts apps/backend/src/app-catalog/app-manifest.util.spec.ts
git commit -m "feat(app-catalog): reject unknown manual-step placeholders at validation"
```

---

### Task 3: Interpolate + re-derive the cert note when listing installed apps

`buildInstalledSummary` currently returns manifest steps verbatim. It should return them interpolated, with the synthesized TLS note appended when the host still has no certificate.

**Files:**
- Modify: `apps/backend/src/app-catalog/app-catalog.service.ts` (`buildInstalledSummary` ~line 340-365, `applicableManualSteps` ~line 464-467, `resolveAppUrl` ~line 455)
- Test: `apps/backend/src/app-catalog/app-catalog.service.spec.ts`

**Interfaces:**
- Consumes: `interpolateStep` (Task 1); `AppCertStepService.plan(appHost): Promise<CertPlan>` and `.execute(plan, appHost): Promise<AppCertStepResult>` (`app-cert-step.service.ts`), where `AppCertStepResult.manualStep?: AppManualStep`. `AppCertStepService` is already injected as `this.certStepService`.
- Produces: `CatalogEntry['installed'].manualSteps` now contains interpolated steps plus, when applicable, the cert note. `applicableManualSteps` gains a second parameter:
  ```ts
  private applicableManualSteps(manifest: AppManifest, values: StepPlaceholders): AppManualStep[]
  ```

- [ ] **Step 1: Write the failing test**

`apps/backend/src/app-catalog/app-catalog.service.spec.ts` already builds a service with mocked collaborators and a `ROW` fixture whose `manifest` carries `manualSteps` (see line 43 and line 338). Follow that file's existing setup exactly — the mocks, `mockDb.__queue`, and the `ROW`/project fixtures are already there. Append:

```ts
describe('installed manual steps', () => {
  it('interpolates {projectPath} and {appHost} into the returned steps', async () => {
    // Fixture project resolves to acme/site; fixture domain resolves to reader.example.com.
    const manifest = {
      ...MANIFEST,
      install: {
        ...MANIFEST.install,
        manualSteps: [
          {
            id: 'grant-access',
            title: 'Give other people access',
            body: 'Add each person as a guest.',
            deepLink: '/repo/{projectPath}/settings?tab=members',
          },
          {
            id: 'bucket-cors',
            title: 'Let the browser upload to your bucket',
            body: 'Allow PUT from {appHost}.',
          },
        ],
      },
    };
    mockDb.__queue([{ ...ROW, manifest }]);

    const result = await service.listCatalog();
    const steps = result.data[0].installed!.manualSteps;

    expect(steps[0].deepLink).toBe('/repo/acme/site/settings?tab=members');
    expect(steps[1].body).toBe('Allow PUT from reader.example.com.');
  });

  it('appends the cert note when the host has no certificate', async () => {
    certStepService.plan.mockResolvedValue({ model: 'direct-no-wildcard', action: 'report' });
    certStepService.execute.mockResolvedValue({
      status: 'action-required',
      detail: 'served over HTTP',
      manualStep: { id: 'provision-wildcard-cert', title: 'Turn on HTTPS', body: 'Body.' },
    });
    mockDb.__queue([ROW]);

    const result = await service.listCatalog();

    expect(result.data[0].installed!.manualSteps.map((s) => s.id)).toContain(
      'provision-wildcard-cert',
    );
  });

  it('omits the cert note when a wildcard already covers the host', async () => {
    certStepService.plan.mockResolvedValue({ model: 'wildcard', action: 'covered' });
    certStepService.execute.mockResolvedValue({ status: 'done', detail: 'covered' });
    mockDb.__queue([ROW]);

    const result = await service.listCatalog();

    expect(result.data[0].installed!.manualSteps.map((s) => s.id)).not.toContain(
      'provision-wildcard-cert',
    );
  });

  it('still lists the app when the cert lookup throws', async () => {
    certStepService.plan.mockRejectedValue(new Error('domains service down'));
    mockDb.__queue([ROW]);

    const result = await service.listCatalog();

    expect(result.data[0].installed).toBeDefined();
    expect(result.data[0].installed!.manualSteps.map((s) => s.id)).not.toContain(
      'provision-wildcard-cert',
    );
  });
});
```

If the existing `certStepService` mock in this file has no `plan`/`execute` jest functions, add them to that mock object: `plan: jest.fn().mockResolvedValue({ model: 'wildcard', action: 'covered' })` and `execute: jest.fn().mockResolvedValue({ status: 'done', detail: 'covered' })`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && npx jest src/app-catalog/app-catalog.service.spec.ts -t "installed manual steps"`
Expected: FAIL — the first case returns the literal `/repo/{projectPath}/settings?tab=members`; the second finds no `provision-wildcard-cert`.

- [ ] **Step 3: Write minimal implementation**

In `apps/backend/src/app-catalog/app-catalog.service.ts`:

Add `interpolateStep` and the `StepPlaceholders` type to the existing import from `./app-manifest.util` (currently `import { manualStepApplies } from './app-manifest.util';` at line 31):

```ts
import { manualStepApplies, interpolateStep, type StepPlaceholders } from './app-manifest.util';
```

Replace `applicableManualSteps` (line 464-467) with:

```ts
  private applicableManualSteps(
    manifest: AppManifest,
    values: StepPlaceholders,
  ): AppManualStep[] {
    const ctx = this.instanceContext();
    return (manifest.install.manualSteps ?? [])
      .filter((step) => manualStepApplies(step, ctx))
      .map((step) => interpolateStep(step, values));
  }
```

Add this private helper next to it:

```ts
  /**
   * The TLS note is synthesized during the install run and attached to the
   * in-memory job, so it used to vanish the moment the catalog refetched
   * (ce#584 follow-up). Re-deriving it here keeps it visible AND makes it
   * self-healing — it disappears on its own once a wildcard covers the host.
   *
   * `AppCertStepService` never throws by contract; the guard is for the day
   * that stops being true. A catalog that fails to list is worse than one
   * missing an advisory line.
   */
  private async certManualStep(appHost: string | undefined): Promise<AppManualStep[]> {
    if (!appHost) return [];
    try {
      const plan = await this.certStepService.plan(appHost);
      const result = await this.certStepService.execute(plan, appHost);
      return result.manualStep ? [result.manualStep] : [];
    } catch (error) {
      this.logger.warn(
        `Could not derive the certificate note for ${appHost}: ${(error as Error).message}`,
      );
      return [];
    }
  }
```

If `AppCatalogService` has no `logger` property yet, add one alongside the constructor: `private readonly logger = new Logger(AppCatalogService.name);` and add `Logger` to the `@nestjs/common` import.

Rewrite `buildInstalledSummary` (line 340-365) so the host is resolved once and reused:

```ts
  private async buildInstalledSummary(
    row: InstalledApp,
    registryVersion: string | undefined,
    domainsById: Map<string, DomainRef>,
  ): Promise<NonNullable<CatalogEntry['installed']>> {
    const manifest = row.manifest as AppManifest;
    const project = await this.projectsService.getProjectById(row.projectId);
    const updateAvailable =
      registryVersion !== undefined && compareSemver(registryVersion, row.version) > 0;

    const projectPath = `${project.owner}/${project.name}`;
    const appHost = row.domainId ? domainsById.get(row.domainId)?.domain : undefined;
    const appUrl = await this.resolveAppUrl(row, domainsById);

    return {
      installedAppId: row.id,
      version: row.version,
      projectId: row.projectId,
      projectName: projectPath,
      alias: row.alias,
      appUrl,
      status: row.status,
      updateAvailable,
      manualSteps: [
        ...this.applicableManualSteps(manifest, { projectPath, appHost }),
        ...(await this.certManualStep(appHost)),
      ],
    };
  }
```

Note `manualStepsAcked` is deliberately gone from the returned object — Task 4 removes the rest of that mechanism, and leaving it here would keep the column alive.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && npx jest src/app-catalog/app-catalog.service.spec.ts`
Expected: PASS for the four new cases. Pre-existing cases at lines 219-231 assert on `manualStepsAcked` and will now fail — **delete those two cases**, since Task 4 removes the feature they cover. Any other case asserting `manualStepsAcked` in the returned summary: delete the assertion line, keep the case.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/app-catalog/app-catalog.service.ts apps/backend/src/app-catalog/app-catalog.service.spec.ts
git commit -m "feat(app-catalog): interpolate manual steps and re-derive the cert note on read"
```

---

### Task 4: Delete the acknowledgement mechanism

Endpoint, DTO, service method, and the DB column. The tick recorded a string only the checkbox read; with the checkbox gone in Task 6, the state has no consumer.

**Files:**
- Modify: `apps/backend/src/app-catalog/app-catalog.controller.ts` (delete the `ack` handler at lines 90-93 and the `AckManualStepDto` import on line 1-20)
- Modify: `apps/backend/src/app-catalog/app-catalog.dtos.ts` (delete `AckManualStepDto`, lines 82-86)
- Modify: `apps/backend/src/app-catalog/app-catalog.service.ts` (delete `ackManualStep`, line 274 and its doc comment; delete `manualStepsAcked` from the `CatalogEntry['installed']` interface at line 83)
- Modify: `apps/backend/src/db/schema/installed-apps.schema.ts:46` (delete the `manualStepsAcked` column)
- Test: `apps/backend/src/app-catalog/app-catalog.controller.spec.ts`, `apps/backend/src/app-catalog/app-catalog.e2e-ish.spec.ts:128`

**Interfaces:**
- Consumes: nothing.
- Produces: `POST /api/admin/apps/installed/:id/ack-manual-step` no longer exists. `CatalogEntry['installed']` no longer has `manualStepsAcked` — Task 6 relies on this.

- [ ] **Step 1: Write the failing test**

In `apps/backend/src/app-catalog/app-catalog.controller.spec.ts`, following that file's existing controller-construction pattern, add:

```ts
it('exposes no manual-step acknowledgement handler', () => {
  expect((controller as unknown as Record<string, unknown>).ack).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && npx jest src/app-catalog/app-catalog.controller.spec.ts -t acknowledgement`
Expected: FAIL — `controller.ack` is still a function.

- [ ] **Step 3: Write minimal implementation**

Delete, in order:

1. `apps/backend/src/app-catalog/app-catalog.controller.ts` — the whole handler:
   ```ts
   @Post('installed/:id/ack-manual-step')
   async ack(@Param('id') id: string, @Body() body: AckManualStepDto) {
     const acked = await this.catalog.ackManualStep(id, body.stepId);
     return { acked };
   }
   ```
   and `AckManualStepDto` from the `./app-catalog.dtos` import list. If `Body` is now unused in the file, drop it from the `@nestjs/common` import too.

2. `apps/backend/src/app-catalog/app-catalog.dtos.ts` — the `AckManualStepDto` class (lines 82-86). If `IsString` is now unused, drop it from the `class-validator` import.

3. `apps/backend/src/app-catalog/app-catalog.service.ts` — the `ackManualStep` method (line 274) with its `/** Idempotent: … */` comment, and the `manualStepsAcked: string[];` line from the `installed` block of the `CatalogEntry` interface (line 83). If `installedApps` is no longer used in an `update()` anywhere in this file, leave the import alone — `requireRow` still selects from it.

4. `apps/backend/src/db/schema/installed-apps.schema.ts` — delete line 46:
   ```ts
   manualStepsAcked: jsonb('manual_steps_acked').$type<string[]>().notNull().default([]),
   ```

5. `apps/backend/src/app-catalog/app-catalog.e2e-ish.spec.ts:128` — delete the `manualStepsAcked: [],` line from the fixture row.

6. `apps/backend/src/app-catalog/app-installer.service.spec.ts:180` — delete the `manualStepsAcked: [] as string[],` line from the fixture row.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && npx jest src/app-catalog`
Expected: PASS across the whole app-catalog suite. Then confirm nothing references the removed names:

Run: `cd apps/backend && grep -rn "manualStepsAcked\|ackManualStep\|AckManualStepDto\|manual_steps_acked" src/`
Expected: no output.

- [ ] **Step 5: Generate the migration (operator, not agent)**

The column drop needs a Drizzle migration, and `db:generate` is interactive — **stop here and hand this to the operator**:

```bash
cd repos/ce/apps/backend && pnpm db:generate
```

Expect a prompt showing a dropped column on `installed_apps`; a name like `drop-manual-steps-acked` is right. When they report the generated filename, review the SQL (it should be a single `ALTER TABLE "installed_apps" DROP COLUMN "manual_steps_acked";`) and include it in the commit.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/app-catalog apps/backend/src/db/schema/installed-apps.schema.ts apps/backend/drizzle
git commit -m "refactor(app-catalog): drop the manual-step acknowledgement mechanism

The tick appended a string to installed_apps.manual_steps_acked, and the only
consumer of that column was the checkbox's own checked state. Nothing gated on
it. Setup notes are read, not completed."
```

---

### Task 5: Interpolate manual steps in the installer

The install job's own copy of the notes needs the same expansion, or the Done screen shows literal braces during the run.

**Files:**
- Modify: `apps/backend/src/app-catalog/app-installer.service.ts` (`applicableManualSteps` ~line 1289-1292, call site ~line 306, second call site ~line 448)
- Test: `apps/backend/src/app-catalog/app-installer.service.spec.ts`

**Interfaces:**
- Consumes: `interpolateStep`, `StepPlaceholders` (Task 1).
- Produces: `InstallJob.manualSteps` entries are interpolated. No signature change visible outside the service.

- [ ] **Step 1: Write the failing test**

The spec file already drives a full install run and asserts on `jobs.get(jobId)!.manualSteps` (see lines 512 and 543). Following that same setup, add:

```ts
it('interpolates {projectPath} and {appHost} into the job manual steps', async () => {
  // MANIFEST_WITH_STEPS mirrors the fixture used at line 69, with a token added.
  const manifest = {
    ...MANIFEST,
    install: {
      ...MANIFEST.install,
      manualSteps: [
        {
          id: 'grant-access',
          title: 'Give other people access',
          body: 'Add each person as a guest.',
          deepLink: '/repo/{projectPath}/settings?tab=members',
        },
      ],
    },
  };

  const jobId = await runInstall({ manifest });

  expect(jobs.get(jobId)!.manualSteps![0].deepLink).toBe(
    '/repo/acme/site/settings?tab=members',
  );
});
```

Use whatever helper the neighbouring tests use to drive a run and to override the bundle's manifest — do not invent a new harness.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && npx jest src/app-catalog/app-installer.service.spec.ts -t interpolates`
Expected: FAIL — `deepLink` is still `/repo/{projectPath}/settings?tab=members`.

- [ ] **Step 3: Write minimal implementation**

In `apps/backend/src/app-catalog/app-installer.service.ts`:

Extend the import on line 29:

```ts
import { manualStepApplies, interpolateStep, type StepPlaceholders } from './app-manifest.util';
```

Replace `applicableManualSteps` (line 1289-1292):

```ts
  private applicableManualSteps(
    manifest: AppManifest,
    values: StepPlaceholders,
  ): AppManualStep[] {
    const ctx = this.instanceContext();
    return (manifest.install.manualSteps ?? [])
      .filter((step) => manualStepApplies(step, ctx))
      .map((step) => interpolateStep(step, values));
  }
```

At the install call site (line 306), the run already has `project` and `appHost` in scope:

```ts
      const stepValues: StepPlaceholders = {
        projectPath: `${project.owner}/${project.name}`,
        appHost: appHost ?? undefined,
      };
      const manualSteps = [
        ...this.applicableManualSteps(manifest, stepValues),
        ...certManualSteps,
      ];
```

At the update call site (line 448), pass the same shape, using whatever project/host variables that scope already holds:

```ts
      const manualSteps = this.applicableManualSteps(manifest, {
        projectPath: `${project.owner}/${project.name}`,
        appHost: appHost ?? undefined,
      });
```

If either scope lacks `project`, load it the way the surrounding code already does (`await this.projectsService.getProjectById(row.projectId)`) rather than threading a new parameter through.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && npx jest src/app-catalog/app-installer.service.spec.ts`
Expected: PASS — the new case and the two pre-existing `manualSteps` cases at lines 512 and 543.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/app-catalog/app-installer.service.ts apps/backend/src/app-catalog/app-installer.service.spec.ts
git commit -m "feat(app-catalog): interpolate manual steps in the installer job"
```

---

### Task 6: `SetupNotes` component + install dialog

One component, two consumers. This task builds it and wires the first consumer; Task 7 wires the card.

**Files:**
- Create: `apps/frontend/src/components/app-catalog/SetupNotes.tsx`
- Create: `apps/frontend/src/components/app-catalog/__tests__/SetupNotes.test.tsx`
- Modify: `apps/frontend/src/components/app-catalog/InstallDialog.tsx` (lines 292-299 and 541-566)
- Modify: `apps/frontend/src/services/appCatalogApi.ts` (lines 10, 87, 264-271, 287)
- Modify: `apps/frontend/src/components/app-catalog/__tests__/InstallDialog.test.tsx`

**Interfaces:**
- Consumes: `AppManualStep` from `@/services/appCatalogApi`.
- Produces:
  ```tsx
  export function SetupNotes(props: {
    steps: AppManualStep[];
    defaultExpanded?: boolean;  // default false
    className?: string;
  }): JSX.Element | null
  ```
  Returns `null` when `steps` is empty. Task 7 renders it with `defaultExpanded` omitted.

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/components/app-catalog/__tests__/SetupNotes.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { SetupNotes } from '../SetupNotes';

const STEPS = [
  {
    id: 'grant-access',
    title: 'Give other people access',
    body: 'Rivulet is private. Add each person as a guest.',
    deepLink: '/repo/acme/site/settings?tab=members',
  },
  { id: 'provision-wildcard-cert', title: 'Turn on HTTPS for this app', body: 'Over HTTP now.' },
];

describe('SetupNotes', () => {
  it('renders nothing when there are no steps', () => {
    const { container } = render(<SetupNotes steps={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows titles collapsed, bodies hidden', () => {
    render(<SetupNotes steps={STEPS} />);

    expect(screen.getByText('Give other people access')).toBeInTheDocument();
    expect(screen.getByText('Turn on HTTPS for this app')).toBeInTheDocument();
    expect(screen.queryByText(/Rivulet is private/)).not.toBeInTheDocument();
  });

  it('says CE cannot do these for you', () => {
    render(<SetupNotes steps={STEPS} />);
    expect(screen.getByText(/can't do these for you/i)).toBeInTheDocument();
  });

  it('expands one body on click without expanding the others', async () => {
    render(<SetupNotes steps={STEPS} />);

    await userEvent.click(screen.getByRole('button', { name: /give other people access/i }));

    expect(screen.getByText(/Rivulet is private/)).toBeInTheDocument();
    expect(screen.queryByText('Over HTTP now.')).not.toBeInTheDocument();
  });

  it('renders the deep link once expanded', async () => {
    render(<SetupNotes steps={STEPS} />);

    await userEvent.click(screen.getByRole('button', { name: /give other people access/i }));

    expect(screen.getByRole('link', { name: /manage members|go/i })).toHaveAttribute(
      'href',
      '/repo/acme/site/settings?tab=members',
    );
  });

  it('shows every body from the start when defaultExpanded', () => {
    render(<SetupNotes steps={STEPS} defaultExpanded />);

    expect(screen.getByText(/Rivulet is private/)).toBeInTheDocument();
    expect(screen.getByText('Over HTTP now.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/components/app-catalog/__tests__/SetupNotes.test.tsx`
Expected: FAIL — cannot resolve `../SetupNotes`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/frontend/src/components/app-catalog/SetupNotes.tsx`:

```tsx
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AppManualStep } from '@/services/appCatalogApi';

interface SetupNotesProps {
  steps: AppManualStep[];
  /** The install dialog has room to show every body; the card does not. */
  defaultExpanded?: boolean;
  className?: string;
}

/**
 * SetupNotes — the app's post-install advice, rendered identically on the
 * install dialog's Done screen and on the installed card.
 *
 * These are notes, not steps: CE cannot grant a user access or write a CORS
 * rule on someone's bucket, and it never claimed to. The list used to carry
 * checkboxes whose only effect was to store their own checked state, which
 * made the copy work harder to explain what the control did not do. Nothing
 * here is stateful.
 */
export function SetupNotes({ steps, defaultExpanded = false, className }: SetupNotesProps) {
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(defaultExpanded ? steps.map((step) => step.id) : []),
  );

  if (steps.length === 0) return null;

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className={cn('space-y-2', className)}>
      <p className="text-sm font-medium">
        Setup notes{' '}
        <span className="font-normal text-muted-foreground">— CE can&apos;t do these for you</span>
      </p>

      <ul className="space-y-1">
        {steps.map((step) => {
          const isOpen = expanded.has(step.id);
          return (
            <li key={step.id}>
              <button
                type="button"
                onClick={() => toggle(step.id)}
                aria-expanded={isOpen}
                className="flex w-full items-start gap-1 text-left text-sm hover:underline"
              >
                {isOpen ? (
                  <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span>{step.title}</span>
              </button>

              {isOpen && (
                <div className="ml-5 mt-1 space-y-1">
                  <p className="text-sm text-muted-foreground">{step.body}</p>
                  {step.deepLink && (
                    <a href={step.deepLink} className="text-sm text-primary underline">
                      Go
                    </a>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/components/app-catalog/__tests__/SetupNotes.test.tsx`
Expected: PASS, all six cases.

- [ ] **Step 5: Wire the install dialog and drop the ack client**

In `apps/frontend/src/services/appCatalogApi.ts`:

- Delete the `ackManualStep` mutation (lines 264-271) and `useAckManualStepMutation` from the export list (line 287).
- Delete `manualStepsAcked: string[];` from the `installed` block (line 87).
- In the file's header comment (line 10), drop `/ackManualStep` from the sentence listing the wizard-backing endpoints.

In `apps/frontend/src/components/app-catalog/InstallDialog.tsx`:

- Delete `useAckManualStepMutation` from the import block and its `const [ackManualStep] = useAckManualStepMutation();` call.
- Replace lines 292-299 with:
  ```tsx
  const manualSteps = entry.installed?.manualSteps ?? job?.manualSteps ?? [];
  ```
  (deleting `manualStepsAcked` and the whole `handleAck` function).
- Replace the entire `{manualSteps.length > 0 && ( … )}` block (lines 541-566) with:
  ```tsx
  <SetupNotes steps={manualSteps} defaultExpanded />
  ```
- Add `import { SetupNotes } from './SetupNotes';` and remove the now-unused `Checkbox` import if nothing else in the file uses it.

In `apps/frontend/src/components/app-catalog/__tests__/InstallDialog.test.tsx`, replace any case asserting checkbox/ack behaviour with:

```tsx
it('renders the setup notes expanded on the done screen', async () => {
  // …existing harness that drives the dialog to a succeeded job…
  expect(screen.getByText(/Setup notes/)).toBeInTheDocument();
  expect(screen.getByText(/Rivulet is private/)).toBeInTheDocument();
});
```

- [ ] **Step 6: Run the frontend suite**

Run: `cd apps/frontend && npx vitest run src/components/app-catalog src/pages/AppsPage.test.tsx`
Expected: PASS. Then confirm the client is clean:

Run: `cd apps/frontend && grep -rn "manualStepsAcked\|ackManualStep\|AckManualStep" src/`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/components/app-catalog apps/frontend/src/services/appCatalogApi.ts
git commit -m "feat(app-catalog): SetupNotes component, replacing the Done-screen checklist"
```

---

### Task 7: Setup notes on the installed card

The permanent home. Collapsed by default so a 3-up grid stays even.

**Files:**
- Modify: `apps/frontend/src/components/app-catalog/AppCard.tsx` (CardContent block, lines 131-135)
- Modify: `apps/frontend/src/components/app-catalog/__tests__/AppCard.test.tsx`

**Interfaces:**
- Consumes: `SetupNotes` (Task 6); `CatalogEntry['installed'].manualSteps` (Task 3).
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

In `apps/frontend/src/components/app-catalog/__tests__/AppCard.test.tsx`, following the file's existing `baseEntry` fixture and render helper (it already has an installed-entry fixture — see the `manualSteps` reference in it), add:

```tsx
describe('setup notes', () => {
  const installedWithNotes = {
    ...baseEntry,
    installed: {
      installedAppId: 'installed-1',
      version: '1.0.0',
      projectId: 'proj-1',
      projectName: 'acme/site',
      alias: 'reader',
      appUrl: 'https://reader.example.com',
      status: 'installed' as const,
      updateAvailable: false,
      manualSteps: [
        {
          id: 'grant-access',
          title: 'Give other people access',
          body: 'Rivulet is private. Add each person as a guest.',
          deepLink: '/repo/acme/site/settings?tab=members',
        },
      ],
    },
  };

  it('shows the note title on an installed card', () => {
    render(<AppCard entry={installedWithNotes} {...noopHandlers} />);

    expect(screen.getByText('Give other people access')).toBeInTheDocument();
    expect(screen.queryByText(/Rivulet is private/)).not.toBeInTheDocument();
  });

  it('expands the body in place', async () => {
    render(<AppCard entry={installedWithNotes} {...noopHandlers} />);

    await userEvent.click(screen.getByRole('button', { name: /give other people access/i }));

    expect(screen.getByText(/Rivulet is private/)).toBeInTheDocument();
  });

  it('renders no setup notes block when the app has none', () => {
    const entry = {
      ...installedWithNotes,
      installed: { ...installedWithNotes.installed, manualSteps: [] },
    };
    render(<AppCard entry={entry} {...noopHandlers} />);

    expect(screen.queryByText(/Setup notes/)).not.toBeInTheDocument();
  });

  it('renders no setup notes block when the app is not installed', () => {
    render(<AppCard entry={baseEntry} {...noopHandlers} />);

    expect(screen.queryByText(/Setup notes/)).not.toBeInTheDocument();
  });
});
```

`noopHandlers` stands for the `onInstall`/`onDetails`/`onUpdateStarted` props the existing tests already pass — use whatever that file already does.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/components/app-catalog/__tests__/AppCard.test.tsx -t "setup notes"`
Expected: FAIL — no note title on the card.

- [ ] **Step 3: Write minimal implementation**

In `apps/frontend/src/components/app-catalog/AppCard.tsx`, add the import:

```tsx
import { SetupNotes } from './SetupNotes';
```

and replace the `CardContent` block (lines 131-135) with:

```tsx
      <CardContent className="flex-1 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {entry.category && (
            <Badge variant="outline" className="capitalize">
              {entry.category}
            </Badge>
          )}
          {installed && <Badge variant="secondary">{`Installed · v${installed.version}`}</Badge>}
        </div>

        {/*
          Titles only, collapsed. The banner above is unconditional so the grid
          doesn't go ragged; two three-line bodies inline would reintroduce
          exactly that unevenness, permanently. Expanding is one click, and the
          notes are worth finding — before this they were reachable only by
          triggering an Update.
        */}
        {installed && <SetupNotes steps={installed.manualSteps} />}
      </CardContent>
```

Add the doc block to the component's header comment, under the existing `- installed →` bullet:

```
 * An installed card also carries its app's setup notes (titles collapsed,
 * bodies expanding in place) — CE can't perform them, so they live where the
 * app lives rather than behind a one-shot dialog.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/components/app-catalog src/pages/AppsPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/app-catalog/AppCard.tsx apps/frontend/src/components/app-catalog/__tests__/AppCard.test.tsx
git commit -m "feat(app-catalog): show setup notes on the installed app card"
```

---

### Task 8: Full CE verification

**Files:** none.

**Interfaces:**
- Consumes: Tasks 1-7.
- Produces: a green CE branch ready for a PR.

- [ ] **Step 1: Run the backend app-catalog suite**

Run: `cd apps/backend && npx jest src/app-catalog`
Expected: PASS, no skipped suites.

- [ ] **Step 2: Run the frontend suite**

Run: `cd apps/frontend && npx vitest run`
Expected: PASS. Note: `pnpm lint` fails on `main` with pre-existing problems in this repo — check that your files add none, don't try to reach zero.

- [ ] **Step 3: Typecheck both apps**

Run: `cd apps/backend && npx tsc --noEmit` then `cd ../frontend && npx tsc --noEmit`
Expected: no errors. A dangling reference to `manualStepsAcked` or `useAckManualStepMutation` surfaces here if the greps in Tasks 4 and 6 missed anything.

- [ ] **Step 4: Confirm the mechanism is fully gone**

Run: `git grep -n "manualStepsAcked\|ackManualStep\|manual_steps_acked" -- apps/ | grep -v drizzle/`
Expected: no output. (The generated migration under `drizzle/` legitimately names the dropped column.)

- [ ] **Step 5: Push and open the PR**

```bash
git push -u origin spec/app-setup-notes
gh pr create --title "feat(app-catalog): setup notes that live on the card" --body-file - <<'EOF'
Implements docs/superpowers/specs/2026-08-02-app-setup-notes-design.md.

An app manifest's `install.manualSteps` rendered as a one-shot checklist on the
install dialog's Done screen, in bodies of 200-570 characters, behind
checkboxes whose only effect was to store their own checked state.

- Notes now live on the installed app's card — titles visible, bodies expanding
  in place. Before this they were reachable only by triggering an Update.
- The acknowledgement mechanism is gone: endpoint, DTO, service method, and the
  `manual_steps_acked` column. Nothing gated on it.
- Manifests can deep-link into the dashboard via `{projectPath}`/`{appHost}`,
  interpolated at read time; unknown tokens fail manifest validation.
- The synthesized TLS note is re-derived on read, fixing it vanishing once the
  catalog refetched, and it now disappears on its own once a wildcard exists.

Copy rewrites for the shipped manifests are in a companion bffless/apps PR.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_018rPL4Mf667ZUyxFN9HmseV
EOF
```

**Ask the operator before pushing** — this repo's rule is to confirm before anything leaves the machine.

---

### Task 9: Rewrite the shipped manifest copy (`bffless/apps`)

Different repo. Branch it first: `cd /home/rico/bffless/repos/apps && git checkout -b fix/setup-notes-copy origin/main`.

**Files:**
- Modify: `apps/reader/bffless-app.json` (the `install.manualSteps` array, lines 44-57)
- Modify: `apps/handoff/bffless-app.json` (the `install.manualSteps` array)
- Modify: `apps/reader/bffless/README.md`
- Modify: `apps/handoff/bffless/README.md`
- Modify: `scripts/check-app-conventions.mjs`
- Create: `scripts/check-app-conventions.test.mjs`

**Interfaces:**
- Consumes: the 220-character rule and the `{projectPath}`/`{appHost}` token set from Global Constraints.
- Produces:
  ```js
  export function checkManualSteps(manifest, manifestRel)  // → string[] of errors
  ```

- [ ] **Step 1: Write the failing test**

Create `scripts/check-app-conventions.test.mjs`, modelled on `scripts/build-registry.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkManualSteps } from './check-app-conventions.mjs'

const REL = 'apps/demo/bffless-app.json'

function manifestWith(steps) {
  return { install: { manualSteps: steps } }
}

test('accepts a short note', () => {
  const errors = checkManualSteps(
    manifestWith([{ id: 'a', title: 'Do the thing', body: 'Short and plain.' }]),
    REL,
  )
  assert.deepEqual(errors, [])
})

test('rejects a body over 220 characters', () => {
  const errors = checkManualSteps(
    manifestWith([{ id: 'a', title: 'T', body: 'x'.repeat(221) }]),
    REL,
  )
  assert.equal(errors.length, 1)
  assert.match(errors[0], /install\.manualSteps\[0\]\.body/)
  assert.match(errors[0], /221 characters/)
  assert.match(errors[0], /220/)
})

test('rejects an unknown placeholder', () => {
  const errors = checkManualSteps(
    manifestWith([{ id: 'a', title: 'T', body: 'Go to {foo}.' }]),
    REL,
  )
  assert.equal(errors.length, 1)
  assert.match(errors[0], /unknown placeholder \{foo\}/)
})

test('accepts the known placeholders', () => {
  const errors = checkManualSteps(
    manifestWith([
      {
        id: 'a',
        title: 'T',
        body: 'Allow PUT from {appHost}.',
        deepLink: '/repo/{projectPath}/settings?tab=members',
      },
    ]),
    REL,
  )
  assert.deepEqual(errors, [])
})

test('accepts a manifest with no manual steps', () => {
  assert.deepEqual(checkManualSteps({ install: {} }, REL), [])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/rico/bffless/repos/apps && node --test scripts/check-app-conventions.test.mjs`
Expected: FAIL — `checkManualSteps` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `scripts/check-app-conventions.mjs`, add near the other module-scope constants:

```js
// Mirrors PLACEHOLDER_TOKENS in the CE repo's app-manifest.util.ts.
const PLACEHOLDER_TOKENS = ['projectPath', 'appHost']
// A note's body is at most three short lines in the install dialog's width.
const MAX_BODY_CHARS = 220
```

and export the checker:

```js
/**
 * A setup note is read, not completed: title is the action, body is at most
 * three short lines. A note that needs a conditional to decide whether it
 * applies to the reader belongs in the app's README instead.
 */
export function checkManualSteps(manifest, manifestRel) {
  const steps = manifest?.install?.manualSteps
  if (!Array.isArray(steps)) return []

  const errors = []

  steps.forEach((step, i) => {
    const at = `${manifestRel}: install.manualSteps[${i}]`

    if (typeof step?.body === 'string' && step.body.length > MAX_BODY_CHARS) {
      errors.push(
        `${at}.body: ${step.body.length} characters, max ${MAX_BODY_CHARS} — ` +
          `shorten it, or move the detail to the app README`,
      )
    }

    for (const field of ['title', 'body', 'deepLink']) {
      const value = step?.[field]
      if (typeof value !== 'string') continue
      for (const match of value.matchAll(/\{([^}]*)\}/g)) {
        if (!PLACEHOLDER_TOKENS.includes(match[1])) {
          errors.push(
            `${at}.${field}: unknown placeholder {${match[1]}} ` +
              `(known: ${PLACEHOLDER_TOKENS.join(', ')})`,
          )
        }
      }
    }
  })

  return errors
}
```

Then call it from `checkManifest`, just before its final `return errors`:

```js
  errors.push(...checkManualSteps(manifest, manifestRel))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/rico/bffless/repos/apps && node --test scripts/check-app-conventions.test.mjs`
Expected: PASS, five cases.

- [ ] **Step 5: Rewrite the manifests**

In `apps/reader/bffless-app.json`, replace the whole `manualSteps` array (lines 44-57) with:

```json
    "manualSteps": [
      {
        "id": "grant-access",
        "title": "Give other people access",
        "body": "Rivulet is private — only signed-in users with access to this project can read feeds. Add each person as a guest. Just you? Nothing to do here.",
        "deepLink": "/repo/{projectPath}/settings?tab=members",
        "appliesWhen": "always"
      }
    ]
```

In `apps/handoff/bffless-app.json`, replace its `manualSteps` array with:

```json
    "manualSteps": [
      {
        "id": "bucket-cors",
        "title": "Let the browser upload to your bucket",
        "body": "Uploads go straight from the browser to your storage bucket, so the bucket needs a CORS rule allowing PUT and Content-Type from {appHost}. CE can't set this for you — do it in your cloud console.",
        "appliesWhen": "bucketStorage"
      }
    ]
```

Both `embed-headers` (reader) and `iframe-headers` (handoff) are deleted — they only matter to a project that already applies a cross-origin-isolation policy, which a reader has to parse the whole paragraph to discover doesn't describe them.

- [ ] **Step 6: Move the cut notes into the READMEs**

Append to `apps/reader/bffless/README.md`:

```markdown
## Posts won't render inline

Rivulet shows a Handoff markdown post's body inline by iframing the Handoff
viewer's chromeless `?embed=1` mode. If this project applies a
cross-origin-isolation policy (COOP/COEP) somewhere else — another app using
`SharedArrayBuffer`, say — that iframe is blocked.

Fix: add a response-header rule matching the reader's files (`apps/reader/**`)
with `Cross-Origin-Opener-Policy: unsafe-none` and
`Cross-Origin-Embedder-Policy: unsafe-none`, at a priority below the isolating
rule, and make sure the Handoff instance allows the reader's origin to frame
it. A fresh project with no isolation policy needs none of this.
```

Append to `apps/handoff/bffless/README.md`:

```markdown
## Sites or embeds won't render in an iframe

Handoff renders user-uploaded Sites (served with no COEP) in an iframe, and
exposes a chromeless `?embed=1` viewer that other apps iframe to show a post
inline. If this project applies a cross-origin-isolation policy (COOP/COEP)
somewhere else, both are blocked.

Fix: add a response-header rule matching Handoff's files (`apps/handoff/**`)
with `Cross-Origin-Opener-Policy: unsafe-none` and
`Cross-Origin-Embedder-Policy: unsafe-none`, at a priority below the isolating
rule. A fresh project with no isolation policy needs none of this.
```

- [ ] **Step 7: Verify the conventions check passes**

Run: `cd /home/rico/bffless/repos/apps && pnpm apps:check`
Expected: `All N app(s) satisfy the per-app pipelines convention.` Both rewritten bodies are under 220 characters (148 and 196).

- [ ] **Step 8: Commit**

```bash
git add apps/reader/bffless-app.json apps/handoff/bffless-app.json apps/reader/bffless/README.md apps/handoff/bffless/README.md scripts/check-app-conventions.mjs scripts/check-app-conventions.test.mjs
git commit -m "fix(apps): rewrite setup notes short, deep-linked, and README-bound

Bodies were 201-571 characters of prose that buried the action inside a
conditional. Each note now states what's true, what to do, and when to skip, in
under 220 characters — enforced by apps:check. The two COOP/COEP notes move to
their app READMEs: they only matter to a project that already applies an
isolation policy, which a reader had to parse the whole paragraph to rule out."
```

**Do not push or open this PR without asking** — in `bffless/apps` a merge is a live rule and manifest deploy.

---

## Self-Review

**Spec coverage.** Copy rule → Task 9 (enforced by Task 9's lint rule, 220 chars). Four manifest rewrites and two cuts → Task 9 Steps 5-6. CE's synthesized cert note rewrite → **gap found**: the spec rewrites `app-cert-step.service.ts:153`'s body but no task did it. Folded into Task 3, below. Placeholders → Tasks 1, 2, 3, 5, and mirrored in Task 9. Ack removal → Task 4 (backend + column) and Task 6 (client). `SetupNotes` → Task 6. Card → Task 7. Install dialog → Task 6. Cert re-derive → Task 3. Error handling for a throwing cert lookup → Task 3, Step 1 case 4. Testing section → covered across Tasks 1-3, 6, 7, 9.

**Placeholder scan.** No TBDs. Every code step carries the actual code. The three places that say "follow the file's existing pattern" (Task 3's mock setup, Task 5's run helper, Task 7's `noopHandlers`) point at named, existing fixtures rather than deferring a decision.

**Type consistency.** `interpolateStep(step, values)` and `StepPlaceholders` are used identically in Tasks 3 and 5. `applicableManualSteps(manifest, values)` has the same two-parameter shape in both services. `SetupNotes` takes `steps`/`defaultExpanded`/`className` in Tasks 6 and 7 alike. `checkManualSteps(manifest, manifestRel)` matches its call site.

**Gap fix — add to Task 3 as a sixth step:**

- [ ] **Step 6 (Task 3): Rewrite CE's synthesized cert note**

In `apps/backend/src/app-catalog/app-cert-step.service.ts`, replace the `manualStep` object at line 153 with:

```ts
          manualStep: {
            id: 'provision-wildcard-cert',
            title: 'Turn on HTTPS for this app',
            body:
              'Your app is live, over HTTP. Provision a wildcard certificate on the Domains ' +
              'page and it switches to HTTPS on its own.',
            deepLink: '/domains',
            appliesWhen: 'selfHosted',
          },
```

The id, `deepLink` and `appliesWhen` are unchanged; only the copy shortens (from ~380 characters to 128). Then run `cd apps/backend && npx jest src/app-catalog/app-cert-step.service.spec.ts` — the case at line 153-156 asserts the body contains "wildcard", which the new copy still does. Commit with Task 3's other changes.
