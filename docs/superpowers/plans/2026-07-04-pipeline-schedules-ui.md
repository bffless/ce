# Pipeline Schedules UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a project-level "Schedules" tab to the CE frontend that lists, creates, edits, enables/disables, and deletes pipeline schedules, backed by the existing `/api/pipeline-schedules` API plus one new convenience endpoint for the target-rule picker.

**Architecture:** The backend `pipeline_schedules` CRUD already exists; we add a single `GET .../pipeline-rules` endpoint so the create form has one clean dropdown of targetable pipeline rules. The frontend adds an RTK Query service, a table page, a shared create/edit dialog, and tab wiring — all matching the existing proxy-rules patterns. The cron field gets a live human-readable preview via `cronstrue`; the authoritative "next run" is read from the backend's `nextRunAt`.

**Tech Stack:** NestJS + Drizzle (backend), React + Vite + RTK Query + Radix/shadcn UI + `date-fns` + `cronstrue` (frontend). Backend tests: Jest. Frontend tests: Vitest + Testing Library.

## Global Constraints

- Backend routes live under `/api/pipeline-schedules` (NOT `/api/projects/...`) — see the controller's file comment; the `/api/projects` prefix has a catch-all that swallows nested paths.
- All backend service methods take `(…, userId, userRole?, apiKeyProjectId?)` and gate with `permissionsService.requireProjectAccess(projectId, userId, userRole, <level>, apiKeyProjectId)`. Read access uses level `'viewer'`.
- A proxy rule is a valid schedule target iff `proxyType === 'pipeline'`.
- Frontend project pages are URL-scoped by `owner`/`repo`; obtain numeric `projectId` via `useGetProjectQuery({ owner, name: repo })` then `project.id`.
- New RTK Query cache tag string: `'PipelineSchedule'` (added to `tagTypes` in `src/services/api.ts`).
- Timezone default is `'UTC'` (matches backend). Target proxy rule is immutable after creation (backend Update DTO omits it) — disable that field in edit mode.
- Follow TDD: write the failing test, see it fail, implement, see it pass, commit. Frequent commits.
- Commit messages use the repo's conventional style, e.g. `feat(pipeline-schedules): ...`.

---

## File Structure

**Backend (`apps/backend`)**
- Modify `src/pipeline-schedules/pipeline-schedules.dto.ts` — add `PipelineRuleOptionDto` response type.
- Modify `src/pipeline-schedules/pipeline-schedules.service.ts` — add `listPipelineRules(...)`.
- Modify `src/pipeline-schedules/pipeline-schedules.controller.ts` — add the `GET .../pipeline-rules` route.
- Modify `src/pipeline-schedules/pipeline-schedules.service.spec.ts` — add tests for `listPipelineRules`.

**Frontend (`apps/frontend`)**
- Create `src/utils/cron.ts` — `describeCron` + `isValidCron` helpers over `cronstrue`.
- Create `src/utils/cron.test.ts` — helper unit tests.
- Create `src/services/pipelineSchedulesApi.ts` — RTK Query service + types.
- Modify `src/services/api.ts` — add `'PipelineSchedule'` tag.
- Create `src/components/pipeline-schedules/ScheduleFormDialog.tsx` — create/edit dialog.
- Create `src/components/pipeline-schedules/ScheduleFormDialog.test.tsx` — dialog tests.
- Create `src/pages/PipelineSchedulesPage.tsx` — table page + inline toggle + delete confirm.
- Create `src/pages/PipelineSchedulesPage.test.tsx` — page tests.
- Modify `src/utils/routes.ts` — add `schedules` helper.
- Modify `src/App.tsx` — add the `schedules` route.
- Modify `src/pages/RepositoryLayout.tsx` — add the Schedules tab + `currentTab` branch.
- Modify `apps/frontend/package.json` — add `cronstrue` dependency.

---

## Task 1: Backend — list pipeline rules for a project

**Files:**
- Modify: `apps/backend/src/pipeline-schedules/pipeline-schedules.dto.ts`
- Modify: `apps/backend/src/pipeline-schedules/pipeline-schedules.service.ts`
- Modify: `apps/backend/src/pipeline-schedules/pipeline-schedules.controller.ts`
- Test: `apps/backend/src/pipeline-schedules/pipeline-schedules.service.spec.ts`

**Interfaces:**
- Produces: `PipelineSchedulesService.listPipelineRules(projectId: string, userId: string, userRole?: string, apiKeyProjectId?: string | null): Promise<PipelineRuleOptionDto[]>`
- Produces REST: `GET /api/pipeline-schedules/projects/:projectId/pipeline-rules` → `{ data: PipelineRuleOptionDto[] }`
- Produces DTO: `PipelineRuleOptionDto { id: string; name: string; ruleSetId: string; ruleSetName: string; pathPattern: string; method: string | null }`

- [ ] **Step 1: Add the response DTO**

In `pipeline-schedules.dto.ts`, append:

```ts
/**
 * A pipeline-type proxy rule offered as a schedule target. Flattened across the
 * project's rule sets so the UI can render a single picker.
 */
export class PipelineRuleOptionDto {
  @ApiProperty() id: string;
  @ApiProperty({ description: 'pipelineConfig.name, falling back to pathPattern' })
  name: string;
  @ApiProperty() ruleSetId: string;
  @ApiProperty() ruleSetName: string;
  @ApiProperty() pathPattern: string;
  @ApiPropertyOptional({ nullable: true }) method: string | null;
}

export class ListPipelineRuleOptionsResponseDto {
  @ApiProperty({ type: [PipelineRuleOptionDto] })
  data: PipelineRuleOptionDto[];
}
```

- [ ] **Step 2: Write the failing service test**

In `pipeline-schedules.service.spec.ts`, add inside the top-level `describe` (reuse the `mockDb`, `buildService`, and `NOW` helpers already in the file). Note the service builds a `permissions` mock — extend `buildService` usage by asserting the guard is called. Add:

```ts
describe('listPipelineRules', () => {
  it('returns pipeline rules for the project mapped to option rows', async () => {
    const requireProjectAccess = jest.fn().mockResolvedValue(undefined);
    const permissions = { requireProjectAccess } as unknown as PermissionsService;
    const systemTrigger = {} as unknown as SystemPipelineTriggerService;
    const service = new PipelineSchedulesService(permissions, systemTrigger);

    mockDb.__reset();
    mockDb.__queue([
      {
        id: 'rule-1',
        ruleSetId: 'set-1',
        ruleSetName: 'Feeds',
        pathPattern: '/api/feeds',
        method: 'GET',
        pipelineName: 'feeds-sync',
      },
      {
        id: 'rule-2',
        ruleSetId: 'set-1',
        ruleSetName: 'Feeds',
        pathPattern: '/api/report',
        method: null,
        pipelineName: null,
      },
    ]);

    const result = await service.listPipelineRules('proj-1', 'user-1', 'admin', null);

    expect(requireProjectAccess).toHaveBeenCalledWith('proj-1', 'user-1', 'admin', 'viewer', null);
    expect(result).toEqual([
      {
        id: 'rule-1',
        name: 'feeds-sync',
        ruleSetId: 'set-1',
        ruleSetName: 'Feeds',
        pathPattern: '/api/feeds',
        method: 'GET',
      },
      {
        id: 'rule-2',
        name: '/api/report', // falls back to pathPattern when pipelineName is null
        ruleSetId: 'set-1',
        ruleSetName: 'Feeds',
        pathPattern: '/api/report',
        method: null,
      },
    ]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/backend && pnpm test -- pipeline-schedules.service`
Expected: FAIL — `service.listPipelineRules is not a function`.

- [ ] **Step 4: Implement `listPipelineRules`**

In `pipeline-schedules.service.ts`, add the `sql` import to the existing drizzle import line:

```ts
import { and, eq, lt, lte, or, isNull, sql } from 'drizzle-orm';
```

Add the DTO import to the existing dto import block:

```ts
import {
  CreatePipelineScheduleDto,
  UpdatePipelineScheduleDto,
  PipelineScheduleResponseDto,
  PipelineRuleOptionDto,
} from './pipeline-schedules.dto';
```

Add this method in the `// ==================== CRUD ====================` section, after `listSchedules`:

```ts
/**
 * All pipeline-type proxy rules in a project, flattened across rule sets, for
 * the schedule target picker. Read-only (viewer access).
 */
async listPipelineRules(
  projectId: string,
  userId: string,
  userRole?: string,
  apiKeyProjectId?: string | null,
): Promise<PipelineRuleOptionDto[]> {
  await this.permissionsService.requireProjectAccess(
    projectId,
    userId,
    userRole,
    'viewer',
    apiKeyProjectId,
  );

  const rows = await db
    .select({
      id: proxyRules.id,
      ruleSetId: proxyRules.ruleSetId,
      ruleSetName: proxyRuleSets.name,
      pathPattern: proxyRules.pathPattern,
      method: proxyRules.method,
      pipelineName: sql<string | null>`${proxyRules.pipelineConfig}->>'name'`,
    })
    .from(proxyRules)
    .innerJoin(proxyRuleSets, eq(proxyRules.ruleSetId, proxyRuleSets.id))
    .where(
      and(eq(proxyRuleSets.projectId, projectId), eq(proxyRules.proxyType, 'pipeline')),
    );

  return rows.map((r) => ({
    id: r.id,
    name: r.pipelineName || r.pathPattern,
    ruleSetId: r.ruleSetId,
    ruleSetName: r.ruleSetName,
    pathPattern: r.pathPattern,
    method: r.method ?? null,
  }));
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/backend && pnpm test -- pipeline-schedules.service`
Expected: PASS.

- [ ] **Step 6: Add the controller route**

In `pipeline-schedules.controller.ts`, add to the dto import block:

```ts
import {
  CreatePipelineScheduleDto,
  UpdatePipelineScheduleDto,
  PipelineScheduleResponseDto,
  ListPipelineSchedulesResponseDto,
  ListPipelineRuleOptionsResponseDto,
} from './pipeline-schedules.dto';
```

Add this handler after `listSchedules` (keep the two-segment `projects/:projectId/...` shape):

```ts
@Get('projects/:projectId/pipeline-rules')
@ApiOperation({ summary: 'List pipeline-type proxy rules in a project (schedule targets)' })
@ApiParam({ name: 'projectId', description: 'Project ID' })
@ApiResponse({ status: 200, type: ListPipelineRuleOptionsResponseDto })
async listPipelineRules(
  @Param('projectId', ParseUUIDPipe) projectId: string,
  @CurrentUser() user: CurrentUserData,
): Promise<ListPipelineRuleOptionsResponseDto> {
  const data = await this.schedulesService.listPipelineRules(
    projectId,
    user.id,
    user.role,
    user.apiKeyProjectId,
  );
  return { data };
}
```

- [ ] **Step 7: Typecheck backend**

Run: `cd apps/backend && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
cd apps/backend
git add src/pipeline-schedules/pipeline-schedules.dto.ts src/pipeline-schedules/pipeline-schedules.service.ts src/pipeline-schedules/pipeline-schedules.controller.ts src/pipeline-schedules/pipeline-schedules.service.spec.ts
git commit -m "feat(pipeline-schedules): add pipeline-rules endpoint for schedule target picker"
```

---

## Task 2: Frontend — cron description/validation helper

**Files:**
- Modify: `apps/frontend/package.json` (add `cronstrue`)
- Create: `apps/frontend/src/utils/cron.ts`
- Test: `apps/frontend/src/utils/cron.test.ts`

**Interfaces:**
- Produces: `describeCron(expression: string): string | null` — human-readable text, or `null` if invalid.
- Produces: `isValidCron(expression: string): boolean`
- Produces: `CRON_PRESETS: { label: string; value: string }[]`

- [ ] **Step 1: Add the dependency**

Run: `cd apps/frontend && pnpm add cronstrue`
Expected: `cronstrue` appears in `package.json` dependencies.

- [ ] **Step 2: Write the failing test**

Create `src/utils/cron.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { describeCron, isValidCron, CRON_PRESETS } from './cron';

describe('cron helpers', () => {
  it('describes a valid 5-field expression', () => {
    expect(describeCron('*/15 * * * *')).toMatch(/every 15 minutes/i);
  });

  it('returns null for an invalid expression', () => {
    expect(describeCron('not a cron')).toBeNull();
  });

  it('isValidCron reflects validity', () => {
    expect(isValidCron('0 2 * * *')).toBe(true);
    expect(isValidCron('99 99 99 99 99')).toBe(false);
    expect(isValidCron('')).toBe(false);
  });

  it('exposes presets whose values are valid cron', () => {
    expect(CRON_PRESETS.length).toBeGreaterThan(0);
    for (const preset of CRON_PRESETS) {
      expect(isValidCron(preset.value)).toBe(true);
    }
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/frontend && pnpm test -- cron`
Expected: FAIL — cannot resolve `./cron`.

- [ ] **Step 4: Implement the helper**

Create `src/utils/cron.ts`:

```ts
import cronstrue from 'cronstrue';

/**
 * Common cadences offered as one-click presets in the schedule form. Values are
 * standard 5-field cron expressions evaluated in the schedule's timezone.
 */
export const CRON_PRESETS: { label: string; value: string }[] = [
  { label: 'Every 15 minutes', value: '*/15 * * * *' },
  { label: 'Hourly', value: '0 * * * *' },
  { label: 'Daily at 2am', value: '0 2 * * *' },
  { label: 'Weekly (Sun 2am)', value: '0 2 * * 0' },
];

/**
 * Human-readable description of a cron expression, or null when it can't be
 * parsed. cronstrue throws on invalid input; we translate that to null.
 */
export function describeCron(expression: string): string | null {
  const trimmed = expression.trim();
  if (!trimmed) return null;
  try {
    return cronstrue.toString(trimmed, { throwExceptionOnParseError: true });
  } catch {
    return null;
  }
}

export function isValidCron(expression: string): boolean {
  return describeCron(expression) !== null;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/frontend && pnpm test -- cron`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd apps/frontend
git add package.json pnpm-lock.yaml src/utils/cron.ts src/utils/cron.test.ts
git commit -m "feat(pipeline-schedules): add cron description/validation helper"
```

---

## Task 3: Frontend — RTK Query service + cache tag

**Files:**
- Modify: `apps/frontend/src/services/api.ts` (add `'PipelineSchedule'` tag)
- Create: `apps/frontend/src/services/pipelineSchedulesApi.ts`

**Interfaces:**
- Produces types: `PipelineSchedule`, `PipelineRuleOption`, `CreatePipelineScheduleDto`, `UpdatePipelineScheduleDto`.
- Produces hooks: `useGetSchedulesQuery(projectId)`, `useGetPipelineRuleOptionsQuery(projectId)`, `useCreateScheduleMutation()`, `useUpdateScheduleMutation()`, `useDeleteScheduleMutation()`.
- `useGetSchedulesQuery` returns `PipelineSchedule[]`; `useGetPipelineRuleOptionsQuery` returns `PipelineRuleOption[]`.

- [ ] **Step 1: Register the cache tag**

In `src/services/api.ts`, add `'PipelineSchedule'` to the `tagTypes` array (after `'BlocklistSettings'`):

```ts
    'Blocklist',
    'BlocklistSettings',
    'PipelineSchedule',
  ],
```

- [ ] **Step 2: Create the service**

Create `src/services/pipelineSchedulesApi.ts`:

```ts
import { api } from './api';

export interface PipelineSchedule {
  id: string;
  projectId: string;
  name: string;
  targetProxyRuleId: string;
  cronExpression: string;
  timezone: string;
  enabled: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
  executionStartedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PipelineRuleOption {
  id: string;
  name: string;
  ruleSetId: string;
  ruleSetName: string;
  pathPattern: string;
  method: string | null;
}

export interface CreatePipelineScheduleDto {
  name: string;
  targetProxyRuleId: string;
  cronExpression: string;
  timezone?: string;
  enabled?: boolean;
}

export interface UpdatePipelineScheduleDto {
  name?: string;
  cronExpression?: string;
  timezone?: string;
  enabled?: boolean;
}

interface SchedulesListResponse {
  data: PipelineSchedule[];
}
interface RuleOptionsListResponse {
  data: PipelineRuleOption[];
}

export const pipelineSchedulesApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getSchedules: builder.query<PipelineSchedule[], string>({
      query: (projectId) => `/api/pipeline-schedules/projects/${projectId}/schedules`,
      transformResponse: (response: SchedulesListResponse) => response.data,
      providesTags: (_result, _error, projectId) => [
        { type: 'PipelineSchedule' as const, id: `project-${projectId}` },
        'PipelineSchedule',
      ],
    }),

    getPipelineRuleOptions: builder.query<PipelineRuleOption[], string>({
      query: (projectId) => `/api/pipeline-schedules/projects/${projectId}/pipeline-rules`,
      transformResponse: (response: RuleOptionsListResponse) => response.data,
    }),

    createSchedule: builder.mutation<
      PipelineSchedule,
      { projectId: string; data: CreatePipelineScheduleDto }
    >({
      query: ({ projectId, data }) => ({
        url: `/api/pipeline-schedules/projects/${projectId}/schedules`,
        method: 'POST',
        body: data,
      }),
      invalidatesTags: (_result, _error, { projectId }) => [
        { type: 'PipelineSchedule' as const, id: `project-${projectId}` },
      ],
    }),

    updateSchedule: builder.mutation<
      PipelineSchedule,
      { id: string; projectId: string; data: UpdatePipelineScheduleDto }
    >({
      query: ({ id, data }) => ({
        url: `/api/pipeline-schedules/schedules/${id}`,
        method: 'PUT',
        body: data,
      }),
      invalidatesTags: (_result, _error, { projectId }) => [
        { type: 'PipelineSchedule' as const, id: `project-${projectId}` },
      ],
    }),

    deleteSchedule: builder.mutation<void, { id: string; projectId: string }>({
      query: ({ id }) => ({
        url: `/api/pipeline-schedules/schedules/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, { projectId }) => [
        { type: 'PipelineSchedule' as const, id: `project-${projectId}` },
      ],
    }),
  }),
});

export const {
  useGetSchedulesQuery,
  useGetPipelineRuleOptionsQuery,
  useCreateScheduleMutation,
  useUpdateScheduleMutation,
  useDeleteScheduleMutation,
} = pipelineSchedulesApi;
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/frontend && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd apps/frontend
git add src/services/api.ts src/services/pipelineSchedulesApi.ts
git commit -m "feat(pipeline-schedules): add RTK Query service and cache tag"
```

---

## Task 4: Frontend — create/edit schedule dialog

**Files:**
- Create: `apps/frontend/src/components/pipeline-schedules/ScheduleFormDialog.tsx`
- Test: `apps/frontend/src/components/pipeline-schedules/ScheduleFormDialog.test.tsx`

**Interfaces:**
- Consumes: hooks from Task 3, helpers from Task 2, `PipelineSchedule`/`PipelineRuleOption` types.
- Produces: `<ScheduleFormDialog projectId owner repo schedule? open onOpenChange />` where `schedule?: PipelineSchedule` (present = edit mode).

- [ ] **Step 1: Write the failing test**

Create `src/components/pipeline-schedules/ScheduleFormDialog.test.tsx` (mirrors the house pattern from `AddToBlocklistDialog.test.tsx`: mock the api hooks and Radix Select):

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScheduleFormDialog } from './ScheduleFormDialog';
import type { PipelineSchedule, PipelineRuleOption } from '@/services/pipelineSchedulesApi';

const mockGetRuleOptions = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();

vi.mock('@/services/pipelineSchedulesApi', () => ({
  useGetPipelineRuleOptionsQuery: (_arg: unknown, opts: { skip?: boolean }) =>
    mockGetRuleOptions(opts),
  useCreateScheduleMutation: () => [mockCreate, { isLoading: false }],
  useUpdateScheduleMutation: () => [mockUpdate, { isLoading: false }],
}));

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => null,
}));

const ruleOption = (o: Partial<PipelineRuleOption> = {}): PipelineRuleOption => ({
  id: 'rule-1',
  name: 'feeds-sync',
  ruleSetId: 'set-1',
  ruleSetName: 'Feeds',
  pathPattern: '/api/feeds',
  method: 'GET',
  ...o,
});

const schedule = (o: Partial<PipelineSchedule> = {}): PipelineSchedule => ({
  id: 'sched-1',
  projectId: 'proj-1',
  name: 'Refresh feeds',
  targetProxyRuleId: 'rule-1',
  cronExpression: '*/15 * * * *',
  timezone: 'UTC',
  enabled: true,
  createdAt: '2026-07-01T00:00:00Z',
  updatedAt: '2026-07-01T00:00:00Z',
  ...o,
});

describe('ScheduleFormDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRuleOptions.mockReturnValue({ data: [ruleOption()], isLoading: false });
    mockCreate.mockReturnValue({ unwrap: () => Promise.resolve(schedule()) });
    mockUpdate.mockReturnValue({ unwrap: () => Promise.resolve(schedule()) });
  });

  it('shows the cron description for a valid expression and enables submit', () => {
    render(
      <ScheduleFormDialog
        projectId="proj-1"
        owner="acme"
        repo="site"
        open
        onOpenChange={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'My schedule' } });
    // default cron field starts blank; type a valid expression
    fireEvent.change(screen.getByLabelText(/cron/i), { target: { value: '0 * * * *' } });
    expect(screen.getByText(/every hour/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create schedule/i })).not.toBeDisabled();
  });

  it('blocks submit when the cron expression is invalid', () => {
    render(
      <ScheduleFormDialog
        projectId="proj-1"
        owner="acme"
        repo="site"
        open
        onOpenChange={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText(/cron/i), { target: { value: 'nonsense' } });
    expect(screen.getByRole('button', { name: /create schedule/i })).toBeDisabled();
  });

  it('applies a preset to the cron field', () => {
    render(
      <ScheduleFormDialog
        projectId="proj-1"
        owner="acme"
        repo="site"
        open
        onOpenChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /hourly/i }));
    expect(screen.getByLabelText(/cron/i)).toHaveValue('0 * * * *');
  });

  it('prefills fields in edit mode', () => {
    render(
      <ScheduleFormDialog
        projectId="proj-1"
        owner="acme"
        repo="site"
        schedule={schedule()}
        open
        onOpenChange={() => {}}
      />,
    );
    expect(screen.getByLabelText(/name/i)).toHaveValue('Refresh feeds');
    expect(screen.getByLabelText(/cron/i)).toHaveValue('*/15 * * * *');
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/frontend && pnpm test -- ScheduleFormDialog`
Expected: FAIL — cannot resolve `./ScheduleFormDialog`.

- [ ] **Step 3: Implement the dialog**

Create `src/components/pipeline-schedules/ScheduleFormDialog.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useGetPipelineRuleOptionsQuery,
  useCreateScheduleMutation,
  useUpdateScheduleMutation,
  type PipelineSchedule,
} from '@/services/pipelineSchedulesApi';
import { describeCron, isValidCron, CRON_PRESETS } from '@/utils/cron';
import { useToast } from '@/hooks/use-toast';

interface ScheduleFormDialogProps {
  projectId: string;
  owner: string;
  repo: string;
  schedule?: PipelineSchedule;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// IANA zones for the timezone picker; UTC first so it's the obvious default.
function timezoneOptions(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  const all = intl.supportedValuesOf ? intl.supportedValuesOf('timeZone') : [];
  return ['UTC', ...all.filter((z) => z !== 'UTC')];
}

export function ScheduleFormDialog({
  projectId,
  owner,
  repo,
  schedule,
  open,
  onOpenChange,
}: ScheduleFormDialogProps) {
  const { toast } = useToast();
  const isEdit = !!schedule;

  const [name, setName] = useState('');
  const [targetProxyRuleId, setTargetProxyRuleId] = useState('');
  const [cronExpression, setCronExpression] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [enabled, setEnabled] = useState(true);
  const [nameError, setNameError] = useState('');

  const { data: ruleOptions = [] } = useGetPipelineRuleOptionsQuery(projectId, {
    skip: !open,
  });
  const [createSchedule, { isLoading: isCreating }] = useCreateScheduleMutation();
  const [updateSchedule, { isLoading: isUpdating }] = useUpdateScheduleMutation();
  const isSaving = isCreating || isUpdating;

  // Load values on open (edit) or reset to defaults (create).
  useEffect(() => {
    if (!open) return;
    if (schedule) {
      setName(schedule.name);
      setTargetProxyRuleId(schedule.targetProxyRuleId);
      setCronExpression(schedule.cronExpression);
      setTimezone(schedule.timezone);
      setEnabled(schedule.enabled);
    } else {
      setName('');
      setTargetProxyRuleId('');
      setCronExpression('');
      setTimezone('UTC');
      setEnabled(true);
    }
    setNameError('');
  }, [open, schedule]);

  const cronDescription = useMemo(() => describeCron(cronExpression), [cronExpression]);
  const cronValid = cronDescription !== null;
  const timezones = useMemo(timezoneOptions, []);

  const canSubmit =
    name.trim().length > 0 &&
    cronValid &&
    (isEdit || targetProxyRuleId.length > 0) &&
    !isSaving;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setNameError('Name is required');
      return;
    }
    if (!isValidCron(cronExpression) || (!isEdit && !targetProxyRuleId)) {
      return;
    }

    try {
      if (isEdit && schedule) {
        await updateSchedule({
          id: schedule.id,
          projectId,
          data: { name: name.trim(), cronExpression: cronExpression.trim(), timezone, enabled },
        }).unwrap();
        toast({ title: 'Schedule updated', description: `"${name}" has been updated.` });
      } else {
        await createSchedule({
          projectId,
          data: {
            name: name.trim(),
            targetProxyRuleId,
            cronExpression: cronExpression.trim(),
            timezone,
            enabled,
          },
        }).unwrap();
        toast({ title: 'Schedule created', description: `"${name}" has been created.` });
      }
      onOpenChange(false);
    } catch (err: unknown) {
      const message =
        (err as { data?: { message?: string } })?.data?.message || 'Failed to save schedule';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    }
  };

  const noRules = !isEdit && ruleOptions.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Schedule' : 'New Schedule'}</DialogTitle>
          <DialogDescription>
            Run a pipeline on a cron cadence. Times are evaluated in the selected timezone.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label htmlFor="schedule-name">Name *</Label>
            <Input
              id="schedule-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Refresh feeds every 15 min"
              className={nameError ? 'border-destructive' : ''}
            />
            {nameError && <p className="text-xs text-destructive">{nameError}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="schedule-target">Target pipeline rule *</Label>
            {noRules ? (
              <p className="text-xs text-muted-foreground">
                No pipeline rules exist in this project yet. Create one under Proxy Rules first.
              </p>
            ) : (
              <Select
                value={targetProxyRuleId}
                onValueChange={setTargetProxyRuleId}
                disabled={isEdit}
              >
                <SelectTrigger id="schedule-target">
                  <SelectValue placeholder="Select a pipeline rule" />
                </SelectTrigger>
                <SelectContent>
                  {ruleOptions.map((rule) => (
                    <SelectItem key={rule.id} value={rule.id}>
                      {rule.name} ({rule.ruleSetName})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {isEdit && (
              <p className="text-xs text-muted-foreground">
                The target rule can't be changed after creation.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="schedule-cron">Cron expression *</Label>
            <Input
              id="schedule-cron"
              value={cronExpression}
              onChange={(e) => setCronExpression(e.target.value)}
              placeholder="*/15 * * * *"
              className={cronExpression && !cronValid ? 'border-destructive' : ''}
            />
            <div className="flex flex-wrap gap-1">
              {CRON_PRESETS.map((preset) => (
                <Button
                  key={preset.value}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setCronExpression(preset.value)}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
            {cronExpression && (
              <p className={`text-xs ${cronValid ? 'text-muted-foreground' : 'text-destructive'}`}>
                {cronValid ? cronDescription : 'Invalid cron expression'}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="schedule-tz">Timezone</Label>
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger id="schedule-tz">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                {timezones.map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {tz}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="schedule-enabled">Enabled</Label>
            <Switch id="schedule-enabled" checked={enabled} onCheckedChange={setEnabled} />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {isEdit
                ? isSaving
                  ? 'Saving...'
                  : 'Save Changes'
                : isSaving
                  ? 'Creating...'
                  : 'Create Schedule'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/frontend && pnpm test -- ScheduleFormDialog`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck**

Run: `cd apps/frontend && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd apps/frontend
git add src/components/pipeline-schedules/ScheduleFormDialog.tsx src/components/pipeline-schedules/ScheduleFormDialog.test.tsx
git commit -m "feat(pipeline-schedules): add create/edit schedule dialog"
```

---

## Task 5: Frontend — schedules page (list, toggle, delete)

**Files:**
- Create: `apps/frontend/src/pages/PipelineSchedulesPage.tsx`
- Test: `apps/frontend/src/pages/PipelineSchedulesPage.test.tsx`

**Interfaces:**
- Consumes: Task 3 hooks, Task 4 `ScheduleFormDialog`, `useGetProjectQuery`, `useProjectRole`, `describeCron`.
- Produces: default-exported? No — named `export function PipelineSchedulesPage()` (matches sibling pages) used by the router in Task 6.

- [ ] **Step 1: Write the failing test**

Create `src/pages/PipelineSchedulesPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PipelineSchedulesPage } from './PipelineSchedulesPage';
import type { PipelineSchedule } from '@/services/pipelineSchedulesApi';

const mockGetSchedules = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useParams: () => ({ owner: 'acme', repo: 'site' }) };
});

vi.mock('@/services/projectsApi', () => ({
  useGetProjectQuery: () => ({ data: { id: 'proj-1' }, isLoading: false }),
}));

vi.mock('@/hooks/useProjectRole', () => ({
  useProjectRole: () => ({ canEdit: true }),
}));

vi.mock('@/services/pipelineSchedulesApi', () => ({
  useGetSchedulesQuery: (_arg: unknown, opts: { skip?: boolean }) => mockGetSchedules(opts),
  useUpdateScheduleMutation: () => [mockUpdate, { isLoading: false }],
  useDeleteScheduleMutation: () => [mockDelete, { isLoading: false }],
  // getPipelineRuleOptions is used by the dialog, which is only rendered lazily;
  // provide a stub so the import resolves.
  useGetPipelineRuleOptionsQuery: () => ({ data: [], isLoading: false }),
  useCreateScheduleMutation: () => [vi.fn(), { isLoading: false }],
}));

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const schedule = (o: Partial<PipelineSchedule> = {}): PipelineSchedule => ({
  id: 'sched-1',
  projectId: 'proj-1',
  name: 'Refresh feeds',
  targetProxyRuleId: 'rule-1',
  cronExpression: '*/15 * * * *',
  timezone: 'UTC',
  enabled: true,
  createdAt: '2026-07-01T00:00:00Z',
  updatedAt: '2026-07-01T00:00:00Z',
  ...o,
});

function renderPage() {
  return render(
    <MemoryRouter>
      <PipelineSchedulesPage />
    </MemoryRouter>,
  );
}

describe('PipelineSchedulesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockReturnValue({ unwrap: () => Promise.resolve(schedule()) });
    mockDelete.mockReturnValue({ unwrap: () => Promise.resolve() });
  });

  it('renders a row per schedule', () => {
    mockGetSchedules.mockReturnValue({ data: [schedule()], isLoading: false });
    renderPage();
    expect(screen.getByText('Refresh feeds')).toBeInTheDocument();
    expect(screen.getByText('*/15 * * * *')).toBeInTheDocument();
  });

  it('shows an empty state when there are no schedules', () => {
    mockGetSchedules.mockReturnValue({ data: [], isLoading: false });
    renderPage();
    expect(screen.getByText(/no schedules yet/i)).toBeInTheDocument();
  });

  it('toggling enabled dispatches updateSchedule', () => {
    mockGetSchedules.mockReturnValue({ data: [schedule()], isLoading: false });
    renderPage();
    fireEvent.click(screen.getByRole('switch'));
    expect(mockUpdate).toHaveBeenCalledWith({
      id: 'sched-1',
      projectId: 'proj-1',
      data: { enabled: false },
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/frontend && pnpm test -- PipelineSchedulesPage`
Expected: FAIL — cannot resolve `./PipelineSchedulesPage`.

- [ ] **Step 3: Implement the page**

Create `src/pages/PipelineSchedulesPage.tsx`:

```tsx
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Plus, Pencil, Trash2, AlertCircle } from 'lucide-react';
import { useGetProjectQuery } from '@/services/projectsApi';
import { useProjectRole } from '@/hooks/useProjectRole';
import {
  useGetSchedulesQuery,
  useUpdateScheduleMutation,
  useDeleteScheduleMutation,
  type PipelineSchedule,
} from '@/services/pipelineSchedulesApi';
import { describeCron } from '@/utils/cron';
import { ScheduleFormDialog } from '@/components/pipeline-schedules/ScheduleFormDialog';
import { useToast } from '@/hooks/use-toast';

function relative(iso?: string): string {
  if (!iso) return '—';
  return formatDistanceToNow(new Date(iso), { addSuffix: true });
}

export function PipelineSchedulesPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const { toast } = useToast();
  const { canEdit } = useProjectRole(owner!, repo!);

  const { data: project } = useGetProjectQuery(
    { owner: owner!, name: repo! },
    { skip: !owner || !repo },
  );
  const projectId = project?.id ?? '';

  const { data: schedules = [], isLoading } = useGetSchedulesQuery(projectId, {
    skip: !projectId,
  });
  const [updateSchedule] = useUpdateScheduleMutation();
  const [deleteSchedule] = useDeleteScheduleMutation();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PipelineSchedule | undefined>(undefined);
  const [deleting, setDeleting] = useState<PipelineSchedule | null>(null);

  const openCreate = () => {
    setEditing(undefined);
    setFormOpen(true);
  };
  const openEdit = (schedule: PipelineSchedule) => {
    setEditing(schedule);
    setFormOpen(true);
  };

  const handleToggle = async (schedule: PipelineSchedule) => {
    try {
      await updateSchedule({
        id: schedule.id,
        projectId,
        data: { enabled: !schedule.enabled },
      }).unwrap();
    } catch (err: unknown) {
      const message =
        (err as { data?: { message?: string } })?.data?.message || 'Failed to update schedule';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteSchedule({ id: deleting.id, projectId }).unwrap();
      toast({ title: 'Schedule deleted', description: `"${deleting.name}" was removed.` });
    } catch (err: unknown) {
      const message =
        (err as { data?: { message?: string } })?.data?.message || 'Failed to delete schedule';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Schedules</h2>
          <p className="text-sm text-muted-foreground">
            Run pipeline rules automatically on a cron cadence.
          </p>
        </div>
        {canEdit && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-2" />
            New schedule
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : schedules.length === 0 ? (
        <div className="border rounded-lg p-8 text-center text-muted-foreground">
          <p className="font-medium">No schedules yet</p>
          <p className="text-sm mt-1">
            Create a schedule to run a pipeline rule on a recurring cadence.
          </p>
        </div>
      ) : (
        <TooltipProvider>
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Cron</TableHead>
                  <TableHead>Timezone</TableHead>
                  <TableHead>Last run</TableHead>
                  <TableHead>Next run</TableHead>
                  <TableHead>Enabled</TableHead>
                  {canEdit && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {schedules.map((schedule) => {
                  const description = describeCron(schedule.cronExpression);
                  return (
                    <TableRow key={schedule.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {schedule.name}
                          {schedule.lastError && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="destructive" className="gap-1">
                                  <AlertCircle className="h-3 w-3" />
                                  Error
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                {schedule.lastError}
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {description ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <code className="text-xs">{schedule.cronExpression}</code>
                            </TooltipTrigger>
                            <TooltipContent>{description}</TooltipContent>
                          </Tooltip>
                        ) : (
                          <code className="text-xs">{schedule.cronExpression}</code>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {schedule.timezone}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {relative(schedule.lastRunAt)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {relative(schedule.nextRunAt)}
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={schedule.enabled}
                          disabled={!canEdit}
                          onCheckedChange={() => handleToggle(schedule)}
                        />
                      </TableCell>
                      {canEdit && (
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEdit(schedule)}
                              aria-label={`Edit ${schedule.name}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setDeleting(schedule)}
                              aria-label={`Delete ${schedule.name}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </TooltipProvider>
      )}

      {projectId && (
        <ScheduleFormDialog
          projectId={projectId}
          owner={owner!}
          repo={repo!}
          schedule={editing}
          open={formOpen}
          onOpenChange={setFormOpen}
        />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete schedule?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleting?.name}" will stop running. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/frontend && pnpm test -- PipelineSchedulesPage`
Expected: PASS (3 tests). If the Radix `Switch` role isn't found under happy-dom, the test mock for `@/components/ui/switch` may be needed — but `AddToBlocklistDialog`/traffic tests use the real Switch successfully, so keep it real first.

- [ ] **Step 5: Typecheck**

Run: `cd apps/frontend && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd apps/frontend
git add src/pages/PipelineSchedulesPage.tsx src/pages/PipelineSchedulesPage.test.tsx
git commit -m "feat(pipeline-schedules): add schedules list page with toggle and delete"
```

---

## Task 6: Frontend — route + tab wiring

**Files:**
- Modify: `apps/frontend/src/utils/routes.ts`
- Modify: `apps/frontend/src/App.tsx`
- Modify: `apps/frontend/src/pages/RepositoryLayout.tsx`

**Interfaces:**
- Consumes: `PipelineSchedulesPage` (Task 5), `routes.schedules`.
- Produces: navigable `/repo/:owner/:repo/schedules` + a Schedules tab.

- [ ] **Step 1: Add the route helper**

In `src/utils/routes.ts`, add after the `proxyRules` helper (before `ruleSet`):

```ts
  /** Pipeline schedules tab */
  schedules: (owner: string, name: string) => `/repo/${owner}/${name}/schedules`,
```

- [ ] **Step 2: Register the route**

In `src/App.tsx`, add the lazy/eager import alongside the other page imports (match the file's existing import style — if siblings like `ProxyRuleSetsPage` are imported directly at top, do the same):

```ts
import { PipelineSchedulesPage } from './pages/PipelineSchedulesPage';
```

Then add the route inside the `/repo/:owner/:repo` `<Route>` block, right after the `proxy-rules/...` routes:

```tsx
          <Route path="schedules" element={<PipelineSchedulesPage />} />
```

- [ ] **Step 3: Add the tab trigger**

In `src/pages/RepositoryLayout.tsx`, extend the `currentTab` chain (add a `schedules` branch — put it before the `proxy-rules` check is fine since paths are distinct; add as its own branch):

```ts
  const currentTab = pathAfterRepo.startsWith('/uploads')
    ? 'uploads'
    : pathAfterRepo.startsWith('/data')
      ? 'data'
      : pathAfterRepo.startsWith('/schedules')
        ? 'schedules'
        : pathAfterRepo.startsWith('/proxy-rules')
          ? 'proxy-rules'
          : pathAfterRepo.startsWith('/aliases')
            ? 'aliases'
            : pathAfterRepo.startsWith('/branches')
              ? 'branches'
              : 'deployments';
```

Add the `TabsTrigger` after the Proxy Rules trigger:

```tsx
            <TabsTrigger value="proxy-rules" asChild>
              <Link to={routes.proxyRules(owner!, repo!)}>Proxy Rules</Link>
            </TabsTrigger>
            <TabsTrigger value="schedules" asChild>
              <Link to={routes.schedules(owner!, repo!)}>Schedules</Link>
            </TabsTrigger>
```

- [ ] **Step 4: Typecheck + run the full frontend test suite**

Run: `cd apps/frontend && pnpm exec tsc --noEmit && pnpm test -- cron ScheduleFormDialog PipelineSchedulesPage`
Expected: typecheck clean; all three suites PASS.

- [ ] **Step 5: Manual verification (headless)**

Follow `CLAUDE.md` local dev: run the app (`pnpm handoff:dev` from `repos/apps` proxies to live `j5s.dev`, OR run the CE frontend dev server), navigate to a project's `/schedules` tab, and confirm the tab renders, the "New schedule" dialog opens, presets fill the cron field, and the cron description appears. Because a cold headless session can't reach gated `/api`, an authed session cookie is needed to see live data — a smoke check that the tab and dialog render (no console errors) is sufficient here.

Run (adjust URL/port to the running dev server):
```bash
cd /home/rico/bffless/localdev-tools && node shot.mjs http://localhost:5173/repo/<owner>/<repo>/schedules --out /tmp/claude-1000/-home-rico-bffless-repos-ce/7c44ba3c-7620-4d93-9748-f6f24a925cfc/scratchpad/schedules.png --full
```
Expected: `consoleErrors:0`; screenshot shows the Schedules tab active.

- [ ] **Step 6: Commit**

```bash
cd apps/frontend
git add src/utils/routes.ts src/App.tsx src/pages/RepositoryLayout.tsx
git commit -m "feat(pipeline-schedules): wire up Schedules tab and route"
```

---

## Self-Review

**Spec coverage:**
- Project-level Schedules tab → Task 6. ✓
- Backend pipeline-rules endpoint → Task 1. ✓
- `cronstrue` dep + preview/validation → Task 2. ✓
- RTK Query service + `PipelineSchedule` tag → Task 3. ✓
- Create/edit dialog (name, immutable-on-edit target, cron+presets+preview, timezone default UTC, enabled) → Task 4. ✓
- List page (columns, lastError badge, inline toggle, delete confirm, permission gating, empty/skeleton states) → Task 5. ✓
- Testing (backend service test, dialog tests, page tests, cron helper test) → Tasks 1,2,4,5. ✓
- "Run now" explicitly out of scope → not built. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `PipelineRuleOptionDto` (backend) mirrors `PipelineRuleOption` (frontend). Hook names (`useGetSchedulesQuery`, `useGetPipelineRuleOptionsQuery`, `useCreateScheduleMutation`, `useUpdateScheduleMutation`, `useDeleteScheduleMutation`) are defined in Task 3 and consumed unchanged in Tasks 4–5. `ScheduleFormDialog` prop shape defined in Task 4 matches its use in Task 5. `describeCron` signature consistent across Tasks 2, 4, 5. ✓

**Known risk flagged in-plan:** Radix `Switch`/`Select` under happy-dom — mitigated by mocking Select in tests (house pattern) and noting the Switch fallback in Task 5 Step 4.
