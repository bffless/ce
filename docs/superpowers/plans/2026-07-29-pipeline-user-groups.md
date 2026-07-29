# Pipeline User Groups (CE) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose a user's group memberships to pipeline function handlers (`user.groups`) and add two member-accessible read endpoints so apps (Handoff first) can grant folder access to CE User Groups.

**Architecture:** Three thin additions to existing seams — a strict-membership lookup in `UserGroupsService`, enrichment of the pipeline user object where `ProxyMiddleware` invokes pipeline execution, and a new non-admin controller in the user-groups module. No schema changes; `user_groups` / `user_group_members` and their indexes already exist.

**Tech Stack:** NestJS, Drizzle ORM (PostgreSQL), Jest (colocated `.spec.ts`, mocked drizzle chains).

**Spec:** `repos/apps` worktree `.claude/worktrees/group-sharing/apps/handoff/docs/superpowers/specs/2026-07-29-group-sharing-design.md` (Part 1 is the CE half).

## Global Constraints

- Repo: `/home/rico/bffless/repos/ce`, worktree `.claude/worktrees/group-sharing`, branch `group-sharing`. All paths below are relative to `apps/backend/`.
- Membership is **strict**: only `user_group_members` rows count. `userGroups.createdBy` does NOT confer membership (creators are admins; admins already short-circuit everywhere).
- The two new endpoints are member-accessible (any authenticated session or API key), never admin-only, and never return member lists or emails.
- Group management stays admin-only — this plan adds **zero** write surface.
- Tests: `pnpm --filter backend test -- <path>` from the repo root (or `pnpm test -- <path>` inside `apps/backend/`).
- Commit after each task; conventional-commit messages (release-please reads them).

---

### Task 1: Membership lookups + directory search in UserGroupsService

**Files:**
- Modify: `src/user-groups/user-groups.service.ts`
- Modify: `src/user-groups/user-groups.dto.ts`
- Create: `src/user-groups/user-groups.service.spec.ts` (none exists today)

**Interfaces:**
- Consumes: existing drizzle tables `userGroups`, `userGroupMembers` from `../db/schema` (already imported by the service).
- Produces (Tasks 2 and 3 call these exact signatures):
  - `getGroupIdsForUser(userId: string): Promise<string[]>`
  - `getMyGroups(userId: string): Promise<MyGroupsResponseDto>` — `{ groups: [{ id, name }] }`
  - `searchGroupDirectory(search?: string, limit?: number): Promise<GroupDirectoryResponseDto>` — `{ groups: [{ id, name, memberCount }] }`

- [ ] **Step 1: Add DTOs** to `src/user-groups/user-groups.dto.ts` (mirror decorator style of the file's existing DTOs; `SearchGroupDirectoryQueryDto` mirrors `SearchDirectoryQueryDto` in `src/users/users.dto.ts`):

```ts
export class MyGroupDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
}

export class MyGroupsResponseDto {
  @ApiProperty({ type: [MyGroupDto] }) groups: MyGroupDto[];
}

export class GroupDirectoryEntryDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() memberCount: number;
}

export class GroupDirectoryResponseDto {
  @ApiProperty({ type: [GroupDirectoryEntryDto] }) groups: GroupDirectoryEntryDto[];
}

export class SearchGroupDirectoryQueryDto {
  @ApiPropertyOptional({ description: 'Case-insensitive group-name substring' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Max results (server-capped)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  limit?: number;
}
```

- [ ] **Step 2: Write failing tests** in `src/user-groups/user-groups.service.spec.ts`. Copy the `mockDb` jest setup from the top of `src/users/users.service.spec.ts` (module-level `jest.mock` of the db import plus chainable select mocks). Cases:

```ts
describe('getGroupIdsForUser', () => {
  it('returns the groupId column of the membership rows', async () => {
    const whereMock = jest.fn().mockResolvedValue([{ groupId: 'g1' }, { groupId: 'g2' }]);
    mockDb.select.mockReturnValueOnce({
      from: jest.fn().mockReturnValue({ where: whereMock }),
    });
    await expect(service.getGroupIdsForUser('u1')).resolves.toEqual(['g1', 'g2']);
  });

  it('returns [] for a user with no memberships', async () => {
    const whereMock = jest.fn().mockResolvedValue([]);
    mockDb.select.mockReturnValueOnce({
      from: jest.fn().mockReturnValue({ where: whereMock }),
    });
    await expect(service.getGroupIdsForUser('u1')).resolves.toEqual([]);
  });
});

describe('getMyGroups', () => {
  it('returns id+name of groups the user is a member of', async () => {
    const orderByMock = jest.fn().mockResolvedValue([{ id: 'g1', name: 'Design' }]);
    mockDb.select.mockReturnValueOnce({
      from: jest.fn().mockReturnValue({
        innerJoin: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({ orderBy: orderByMock }),
        }),
      }),
    });
    await expect(service.getMyGroups('u1')).resolves.toEqual({
      groups: [{ id: 'g1', name: 'Design' }],
    });
  });
});

describe('searchGroupDirectory', () => {
  it('returns groups with numeric memberCount and applies the default limit', async () => {
    const limitMock = jest.fn().mockResolvedValue([{ id: 'g1', name: 'Design', memberCount: '3' }]);
    mockDb.select.mockReturnValueOnce({
      from: jest.fn().mockReturnValue({
        leftJoin: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            groupBy: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockReturnValue({ limit: limitMock }),
            }),
          }),
        }),
      }),
    });
    const result = await service.searchGroupDirectory(undefined);
    expect(result.groups).toEqual([{ id: 'g1', name: 'Design', memberCount: 3 }]);
    expect(limitMock).toHaveBeenCalledWith(20);
  });

  it('caps an oversized limit at 50', async () => {
    /* same chain mock */
    await service.searchGroupDirectory('a', 9999);
    expect(limitMock).toHaveBeenCalledWith(50);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test -- src/user-groups/user-groups.service.spec.ts`
Expected: FAIL — `getGroupIdsForUser is not a function` (and siblings).

- [ ] **Step 4: Implement the three methods** in `src/user-groups/user-groups.service.ts` (add `ilike`, `asc`, `sql` to the existing drizzle-orm import):

```ts
const GROUP_DIRECTORY_MAX_LIMIT = 50;

/**
 * Group ids the user is a MEMBER of (strict: user_group_members only;
 * creating a group does not make you a member). Consumed per-request by
 * the pipeline context builder — keep it a single indexed query.
 */
async getGroupIdsForUser(userId: string): Promise<string[]> {
  const rows = await db
    .select({ groupId: userGroupMembers.groupId })
    .from(userGroupMembers)
    .where(eq(userGroupMembers.userId, userId));
  return rows.map((row) => row.groupId);
}

/**
 * The session user's own memberships, id + name only. Member-accessible:
 * apps need it client-side to mirror the gate's group evaluation.
 */
async getMyGroups(userId: string): Promise<MyGroupsResponseDto> {
  const rows = await db
    .select({ id: userGroups.id, name: userGroups.name })
    .from(userGroupMembers)
    .innerJoin(userGroups, eq(userGroupMembers.groupId, userGroups.id))
    .where(eq(userGroupMembers.userId, userId))
    .orderBy(asc(userGroups.name));
  return { groups: rows };
}

/**
 * Group picker for share dialogs. Member-accessible and deliberately
 * minimal: id, name, member count — never members or emails. A blank
 * search returns all groups (they are few and browsable), unlike the
 * user directory where a blank term must not dump the user table.
 */
async searchGroupDirectory(search?: string, limit = 20): Promise<GroupDirectoryResponseDto> {
  const term = (search ?? '').trim();
  const capped = Math.min(Math.max(Math.trunc(limit) || 20, 1), GROUP_DIRECTORY_MAX_LIMIT);

  const rows = await db
    .select({
      id: userGroups.id,
      name: userGroups.name,
      memberCount: sql<number>`count(${userGroupMembers.id})`,
    })
    .from(userGroups)
    .leftJoin(userGroupMembers, eq(userGroupMembers.groupId, userGroups.id))
    .where(term.length > 0 ? ilike(userGroups.name, `%${term}%`) : undefined)
    .groupBy(userGroups.id)
    .orderBy(asc(userGroups.name))
    .limit(capped);

  return { groups: rows.map((r) => ({ id: r.id, name: r.name, memberCount: Number(r.memberCount) })) };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test -- src/user-groups/user-groups.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/user-groups/
git commit -m "feat(user-groups): membership lookups and member-accessible directory search"
```

---

### Task 2: `user.groups` through the pipeline context

**Files:**
- Modify: `src/pipelines/execution/pipeline-context.interface.ts` (PipelineUser, ~line 6)
- Modify: `src/pipelines/execution/pipeline-execution.service.ts` (user params at ~lines 47 and 108)
- Modify: `src/pipelines/handlers/function.handler.ts` (user mapping at ~lines 70–75)
- Modify: `src/proxy-rules/proxy-rules.module.ts` (import UserGroupsModule)
- Modify: `src/proxy-rules/proxy.middleware.ts` (inject service; enrich at the pipeline-exec call site, ~line 1142)
- Test: `src/pipelines/handlers/function.handler.spec.ts` (extend if present, create alongside `ai.handler.spec.ts` otherwise)

**Interfaces:**
- Consumes: `getGroupIdsForUser(userId): Promise<string[]>` from Task 1.
- Produces: sandboxed pipeline functions receive `user.groups: string[]` (empty array when authenticated with no memberships; `user` still `undefined` when anonymous). This is the contract the Handoff plan's gate functions read.

- [ ] **Step 1: Write the failing handler test** — assert `FunctionRunnerService.run` receives `data.user.groups`. Mirror the mock style of `ai.handler.spec.ts` for constructing the handler with a mocked runner:

```ts
it('exposes user.groups to the sandboxed function', async () => {
  runnerMock.run.mockResolvedValue({ ok: true });
  const context = makeContext({
    user: { id: 'u1', email: 'u@example.com', role: 'user', groups: ['g1', 'g2'] },
  });
  await handler.execute(context, makeStep({ code: 'export default () => ({})' }));
  expect(runnerMock.run).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ user: expect.objectContaining({ groups: ['g1', 'g2'] }) }),
    expect.anything(),
  );
});

it('defaults user.groups to [] when the context user has none', async () => {
  runnerMock.run.mockResolvedValue({ ok: true });
  const context = makeContext({ user: { id: 'u1', role: 'user' } });
  await handler.execute(context, makeStep({ code: 'export default () => ({})' }));
  expect(runnerMock.run).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ user: expect.objectContaining({ groups: [] }) }),
    expect.anything(),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/pipelines/handlers/function.handler.spec.ts`
Expected: FAIL — received user object has no `groups` key.

- [ ] **Step 3: Type + mapping changes**

`pipeline-context.interface.ts`:

```ts
export interface PipelineUser {
  id: string;
  email?: string;
  role?: string;
  /** Group ids the user is a member of (strict membership). Absent only on pre-groups callers. */
  groups?: string[];
}
```

`pipeline-execution.service.ts` — widen both `user?: { id: string; email?: string; role?: string }` params (lines ~47 and ~108) to `user?: PipelineUser` (import from `./pipeline-context.interface`).

`function.handler.ts` user mapping:

```ts
user: context.user
  ? {
      id: context.user.id,
      email: context.user.email,
      role: context.user.role,
      groups: context.user.groups ?? [],
    }
  : undefined,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/pipelines/handlers/function.handler.spec.ts`
Expected: PASS.

- [ ] **Step 5: Enrich at the middleware call site.** In `src/proxy-rules/proxy-rules.module.ts`, add `UserGroupsModule` to `imports` (it already exports `UserGroupsService`). In `proxy.middleware.ts`, add `private readonly userGroupsService: UserGroupsService` to the constructor, then at the pipeline-execution call site (~line 1142, where `getOptionalUser` feeds `executePipelineWithDebug`):

```ts
const user = await this.getOptionalUser(req, res);
let pipelineUser: PipelineUser | undefined = user;
if (user) {
  try {
    pipelineUser = { ...user, groups: await this.userGroupsService.getGroupIdsForUser(user.id) };
  } catch (error) {
    // Group lookup must never take the request down — degrade to "no groups".
    this.logger.warn(`Group membership lookup failed for ${user.id}: ${error}`);
    pipelineUser = { ...user, groups: [] };
  }
}
```

Pass `pipelineUser` (not `user`) into `executePipelineWithDebug`. Do NOT enrich inside `getOptionalUser` — its other caller (~line 583, proxy access control) doesn't need groups and shouldn't pay the query.

- [ ] **Step 6: Run the pipelines + proxy-rules suites**

Run: `pnpm test -- src/pipelines src/proxy-rules`
Expected: PASS (existing proxy.middleware specs may need the new constructor dep mocked — provide `{ getGroupIdsForUser: jest.fn().mockResolvedValue([]) }`).

- [ ] **Step 7: Commit**

```bash
git add src/pipelines/ src/proxy-rules/
git commit -m "feat(pipelines): expose user group memberships as user.groups in handler context"
```

---

### Task 3: Member-accessible directory controller

**Files:**
- Create: `src/user-groups/user-groups-directory.controller.ts`
- Create: `src/user-groups/user-groups-directory.controller.spec.ts`
- Modify: `src/user-groups/user-groups.module.ts`

**Interfaces:**
- Consumes: `searchGroupDirectory`, `getMyGroups` from Task 1; `ApiKeyGuard`, `RolesGuard`, `CurrentUser` from `../auth/` (same imports as `user-groups.controller.ts`).
- Produces: `GET /api/user-groups/directory` → `GroupDirectoryResponseDto`; `GET /api/user-groups/mine` → `MyGroupsResponseDto`. These are the URLs the Handoff proxy rules target.

- [ ] **Step 1: Write failing controller tests** (mocked service, like `users.controller.spec.ts`):

```ts
it('delegates directory search to the service', async () => {
  serviceMock.searchGroupDirectory.mockResolvedValue({ groups: [] });
  await expect(controller.searchDirectory({ search: 'des', limit: 5 })).resolves.toEqual({ groups: [] });
  expect(serviceMock.searchGroupDirectory).toHaveBeenCalledWith('des', 5);
});

it('returns the current user own memberships', async () => {
  serviceMock.getMyGroups.mockResolvedValue({ groups: [{ id: 'g1', name: 'Design' }] });
  await expect(controller.myGroups({ id: 'u1', email: 'e', role: 'user' })).resolves.toEqual({
    groups: [{ id: 'g1', name: 'Design' }],
  });
  expect(serviceMock.getMyGroups).toHaveBeenCalledWith('u1');
});

it('is NOT admin-gated (no roles metadata on controller or handlers)', () => {
  expect(Reflect.getMetadata('roles', UserGroupsDirectoryController)).toBeUndefined();
  expect(Reflect.getMetadata('roles', UserGroupsDirectoryController.prototype.searchDirectory)).toBeUndefined();
  expect(Reflect.getMetadata('roles', UserGroupsDirectoryController.prototype.myGroups)).toBeUndefined();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- src/user-groups/user-groups-directory.controller.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the controller** (guards but **no** `@Roles` — that is the whole point; management stays in the admin controller):

```ts
@Controller('api/user-groups')
@UseGuards(ApiKeyGuard, RolesGuard)
@ApiTags('User Groups')
@ApiBearerAuth()
export class UserGroupsDirectoryController {
  constructor(private readonly userGroupsService: UserGroupsService) {}

  @Get('directory')
  @ApiOperation({
    summary: 'Search the group directory',
    description:
      'Group picker for share dialogs. Available to any authenticated user (session or ' +
      'API key) — NOT admin-only. Returns only id, name, and member count; never member ' +
      'lists or emails. A blank search lists all groups (capped).',
  })
  @ApiResponse({ status: 200, type: GroupDirectoryResponseDto })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async searchDirectory(@Query() query: SearchGroupDirectoryQueryDto): Promise<GroupDirectoryResponseDto> {
    return this.userGroupsService.searchGroupDirectory(query.search, query.limit);
  }

  @Get('mine')
  @ApiOperation({
    summary: "List the current user's group memberships",
    description:
      'Strict memberships only (creating a group does not make you a member). Lets an app ' +
      'mirror server-side group access checks client-side.',
  })
  @ApiResponse({ status: 200, type: MyGroupsResponseDto })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async myGroups(@CurrentUser() user: CurrentUserData): Promise<MyGroupsResponseDto> {
    return this.userGroupsService.getMyGroups(user.id);
  }
}
```

(Declare the same `interface CurrentUserData { id: string; email: string; role: string }` used by `user-groups.controller.ts`.)

- [ ] **Step 4: Register it FIRST in the module.** `UserGroupsController` has `@Get(':id')`; Nest registers routes in `controllers` array order, so the static `directory`/`mine` paths must come first or `:id` swallows them (`id === 'directory'` → 403 for non-admins):

```ts
controllers: [UserGroupsDirectoryController, UserGroupsController],
```

Add a comment on that line stating the ordering constraint.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test -- src/user-groups/`
Expected: PASS.

- [ ] **Step 6: Manual route-order check** (this is the failure the unit tests can't see). Start the backend (`pnpm dev` or the docker dev stack) and, with a **non-admin** session or API key:

```bash
curl -s -H "X-API-Key: $NON_ADMIN_KEY" http://localhost:3000/api/user-groups/directory
curl -s -H "X-API-Key: $NON_ADMIN_KEY" http://localhost:3000/api/user-groups/mine
```

Expected: 200 JSON from both (NOT 403). Then confirm admin routes still work: `curl -s -H "X-API-Key: $ADMIN_KEY" http://localhost:3000/api/user-groups` → 200.

- [ ] **Step 7: Commit**

```bash
git add src/user-groups/
git commit -m "feat(user-groups): member-accessible group directory and my-memberships endpoints"
```

---

### Task 4: Full verification

- [ ] **Step 1: Full backend suite**

Run: `pnpm test` (from `apps/backend/`)
Expected: PASS, no regressions.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: clean.

- [ ] **Step 3: End-to-end smoke through a pipeline.** In the local dev stack, create a throwaway proxy rule with a one-step pipeline `function_handler` whose code is `export default function h({ user }) { return { groups: (user && user.groups) || null } }`, call it with a session/API key belonging to a user who is a member of one group, and confirm the response contains that group id. Delete the rule afterwards.

- [ ] **Step 4: Push and open PR** (rebase on `origin/main` first; PR title `feat: pipeline user.groups + member-accessible group directory`). Merging and the release/deploy to j5s.dev gate the Handoff plan — its rules 404 gracefully until then.
