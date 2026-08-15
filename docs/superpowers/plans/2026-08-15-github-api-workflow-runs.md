# `github_api` Workflow-Run Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `list_workflow_runs` and `get_workflow_run` actions to CE's `github_api` pipeline handler so a pipeline can read GitHub Actions run status using the project's existing GitHub integration credential.

**Architecture:** Both actions mirror the existing `list_pull_requests` action exactly — expression-evaluated `owner`/`repo`, a `fetch` to `api.github.com` with the integration's PAT, and a mapped output object. No new credential path, no new service, no schema change. The handler currently ships with no spec file, so this work also creates `github-api.handler.spec.ts`.

**Tech Stack:** NestJS, TypeScript, Jest. Frontend config UI is React + Radix `Select`.

**Spec:** `/home/rico/bffless/repos/studio-oneshot/docs/superpowers/specs/2026-08-15-studio-oneshot-design.md` (section "CE dependency: two new `github_api` actions"). Also published at https://handoff.bffless.dev/tree/specs/studio-one-shot

## Global Constraints

- Work in a worktree: `repos/ce` is a **shared checkout**. Branch via `.claude/worktrees`, never commit to the shared `main` checkout.
- The GitHub PAT comes from `IntegrationsService.getActiveConfig(projectId, 'github')`. **Never** read it from `secrets.*`, never place it in step output, never log it.
- Every string-typed config value is run through `this.expressionEvaluator.evaluateExpression(...)`, matching every other action in this handler.
- GitHub request headers are exactly: `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`.
- Error shape on failure: `{ success: false, error: { code: 'GITHUB_API_ERROR', message: ... } }`. Config problems throw `ConfigurationError(msg, 'github_api')`.
- Conventional commit titles — the PR title becomes the squashed commit and drives release-please.

---

### Task 1: `list_workflow_runs` action

**Files:**
- Modify: `apps/backend/src/pipelines/handlers/github-api.handler.ts` (config interface ~line 15-30, `validateConfig` ~line 196, `execute` switch ~line 264, new private method after `listPullRequests`)
- Create: `apps/backend/src/pipelines/handlers/github-api.handler.spec.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `GitHubApiHandlerConfig` gains `runId?: string`, `event?: string`, `status?: string`, `perPage?: number`. Action union gains `'list_workflow_runs'`. Private method `listWorkflowRuns(config, context, step, token): Promise<StepResult>` returning `output` as an **array** of `{ id, name, display_title, status, conclusion, html_url, run_number, event, head_branch, created_at, updated_at }`.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/pipelines/handlers/github-api.handler.spec.ts`:

```typescript
import { GitHubApiHandler } from './github-api.handler';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { PipelineContext } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';
import { ConfigurationError } from '../errors';
import { IntegrationsService } from '../../integrations/integrations.service';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function makeFetchResponse(opts: { status: number; body: unknown }): Response {
  const { status, body } = opts;
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function makeContext(): PipelineContext {
  return {
    request: { headers: {} },
    user: undefined,
    stepOutputs: {},
    projectId: 'p-1',
    pipelineId: 'pl-1',
    metadata: { path: '/', method: 'GET', headers: {}, query: {}, body: {} },
  } as unknown as PipelineContext;
}

function makeStep(config: Record<string, unknown>): PipelineStep {
  return {
    id: 'step-1',
    pipelineId: 'pl-1',
    name: 'runs',
    handlerType: 'github_api',
    config: config as PipelineStep['config'],
    order: 0,
    isEnabled: true,
  };
}

const RUN_FIXTURE = {
  id: 42,
  name: 'Studio One-Shot',
  display_title: 'one-shot tok-abc',
  status: 'in_progress',
  conclusion: null,
  html_url: 'https://github.com/o/r/actions/runs/42',
  run_number: 7,
  event: 'repository_dispatch',
  head_branch: 'main',
  created_at: '2026-08-15T10:00:00Z',
  updated_at: '2026-08-15T10:05:00Z',
};

describe('GitHubApiHandler', () => {
  let handler: GitHubApiHandler;
  let integrations: { getActiveConfig: jest.Mock };

  beforeEach(() => {
    mockFetch.mockReset();
    const registry = { register: jest.fn() } as unknown as StepHandlerRegistry;
    const evaluator = new ExpressionEvaluator();
    integrations = { getActiveConfig: jest.fn().mockResolvedValue({ personalAccessToken: 'pat-1' }) };
    handler = new GitHubApiHandler(
      registry,
      evaluator,
      integrations as unknown as IntegrationsService,
    );
  });

  describe('list_workflow_runs', () => {
    it('requires owner and repo', () => {
      expect(() => handler.validateConfig({ action: 'list_workflow_runs', repo: 'r' } as never))
        .toThrow(ConfigurationError);
      expect(() => handler.validateConfig({ action: 'list_workflow_runs', owner: 'o' } as never))
        .toThrow(ConfigurationError);
    });

    it('rejects an out-of-range perPage', () => {
      expect(() =>
        handler.validateConfig({ action: 'list_workflow_runs', owner: 'o', repo: 'r', perPage: 0 } as never),
      ).toThrow(/perPage/);
      expect(() =>
        handler.validateConfig({ action: 'list_workflow_runs', owner: 'o', repo: 'r', perPage: 101 } as never),
      ).toThrow(/perPage/);
    });

    it('maps runs and passes event/status/per_page as query params', async () => {
      mockFetch.mockResolvedValue(
        makeFetchResponse({ status: 200, body: { total_count: 1, workflow_runs: [RUN_FIXTURE] } }),
      );

      const result = await handler.execute(
        makeContext(),
        makeStep({
          action: 'list_workflow_runs',
          owner: 'o',
          repo: 'r',
          event: 'repository_dispatch',
          status: 'in_progress',
          perPage: 10,
        }),
      );

      expect(result.success).toBe(true);
      expect(result.output).toEqual([
        {
          id: 42,
          name: 'Studio One-Shot',
          display_title: 'one-shot tok-abc',
          status: 'in_progress',
          conclusion: null,
          html_url: 'https://github.com/o/r/actions/runs/42',
          run_number: 7,
          event: 'repository_dispatch',
          head_branch: 'main',
          created_at: '2026-08-15T10:00:00Z',
          updated_at: '2026-08-15T10:05:00Z',
        },
      ]);

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('/repos/o/r/actions/runs?');
      expect(calledUrl).toContain('per_page=10');
      expect(calledUrl).toContain('event=repository_dispatch');
      expect(calledUrl).toContain('status=in_progress');
    });

    it('defaults per_page to 30 and omits absent filters', async () => {
      mockFetch.mockResolvedValue(
        makeFetchResponse({ status: 200, body: { total_count: 0, workflow_runs: [] } }),
      );

      await handler.execute(
        makeContext(),
        makeStep({ action: 'list_workflow_runs', owner: 'o', repo: 'r' }),
      );

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('per_page=30');
      expect(calledUrl).not.toContain('event=');
      expect(calledUrl).not.toContain('status=');
    });

    it('returns GITHUB_API_ERROR on a non-2xx response', async () => {
      mockFetch.mockResolvedValue(makeFetchResponse({ status: 404, body: { message: 'Not Found' } }));

      const result = await handler.execute(
        makeContext(),
        makeStep({ action: 'list_workflow_runs', owner: 'o', repo: 'r' }),
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('GITHUB_API_ERROR');
      expect(result.error?.message).toContain('Not Found');
    });

    it('fails with GITHUB_NOT_CONFIGURED when the integration is missing', async () => {
      integrations.getActiveConfig.mockResolvedValue(null);

      const result = await handler.execute(
        makeContext(),
        makeStep({ action: 'list_workflow_runs', owner: 'o', repo: 'r' }),
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('GITHUB_NOT_CONFIGURED');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('dispatch (existing action — regression cover)', () => {
    it('POSTs event_type + client_payload and treats 204 as success', async () => {
      mockFetch.mockResolvedValue(makeFetchResponse({ status: 204, body: {} }));

      const result = await handler.execute(
        makeContext(),
        makeStep({
          action: 'dispatch',
          owner: 'o',
          repo: 'r',
          eventType: 'oneshot-run',
          clientPayload: { run_token: 'tok-abc' },
        }),
      );

      expect(result.success).toBe(true);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.github.com/repos/o/r/dispatches');
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({
        event_type: 'oneshot-run',
        client_payload: { run_token: 'tok-abc' },
      });
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/backend && pnpm exec jest src/pipelines/handlers/github-api.handler.spec.ts
```

Expected: FAIL. The `list_workflow_runs` tests fail because `validateConfig` throws "Unknown action 'list_workflow_runs'". The `dispatch` test should already PASS — that action exists.

- [ ] **Step 3: Add the config fields and the action to the union**

In `github-api.handler.ts`, extend the action union on `GitHubApiHandlerConfig`:

```typescript
  action: 'create_repo_from_template' | 'set_repo_variable' | 'create_issue' | 'add_issue_comment' | 'close_issue' | 'close_pull_request' | 'merge_pull_request' | 'list_pull_requests' | 'dispatch' | 'list_workflow_runs';
```

And add a new field group after the `dispatch` fields:

```typescript
  // --- workflow run fields ---

  /** Filter runs by triggering event, e.g. "'repository_dispatch'" (expression) */
  event?: string;

  /** Filter runs by status or conclusion, e.g. "'in_progress'" (expression) */
  status?: string;

  /** Number of runs to return, 1-100 (default 30) */
  perPage?: number;
```

- [ ] **Step 4: Add validation**

In `validateConfig`, insert a branch before the final `else`:

```typescript
    } else if (config.action === 'list_workflow_runs') {
      if (!config.owner) {
        throw new ConfigurationError('owner is required for list_workflow_runs', 'github_api');
      }
      if (!config.repo) {
        throw new ConfigurationError('repo is required for list_workflow_runs', 'github_api');
      }
      if (config.perPage !== undefined && (config.perPage < 1 || config.perPage > 100)) {
        throw new ConfigurationError('perPage must be between 1 and 100', 'github_api');
      }
```

Update the `Unknown action` message in the final `else` to end with `..., list_pull_requests, dispatch, list_workflow_runs`.

- [ ] **Step 5: Wire the execute switch**

After the `list_pull_requests` branch in `execute()`:

```typescript
    if (config.action === 'list_workflow_runs') {
      return this.listWorkflowRuns(config, context, step, token);
    }
```

- [ ] **Step 6: Implement the method**

Add after `listPullRequests`, mirroring its structure:

```typescript
  /** Shape a GitHub workflow-run object down to the fields pipelines actually use. */
  private mapWorkflowRun(run: any) {
    return {
      id: run.id,
      name: run.name,
      display_title: run.display_title,
      status: run.status,
      conclusion: run.conclusion,
      html_url: run.html_url,
      run_number: run.run_number,
      event: run.event,
      head_branch: run.head_branch,
      created_at: run.created_at,
      updated_at: run.updated_at,
    };
  }

  private async listWorkflowRuns(
    config: GitHubApiHandlerConfig,
    context: PipelineContext,
    step: PipelineStep,
    token: string,
  ): Promise<StepResult> {
    const owner = String(this.expressionEvaluator.evaluateExpression(config.owner!, context, step.name));
    const repo = String(this.expressionEvaluator.evaluateExpression(config.repo!, context, step.name));

    const params = new URLSearchParams({ per_page: String(config.perPage ?? 30) });
    if (config.event) {
      params.set('event', String(this.expressionEvaluator.evaluateExpression(config.event, context, step.name)));
    }
    if (config.status) {
      params.set('status', String(this.expressionEvaluator.evaluateExpression(config.status, context, step.name)));
    }

    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/actions/runs?${params.toString()}`;
    this.logger.debug(`Listing workflow runs on '${owner}/${repo}'`);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        return {
          success: false,
          error: { code: 'GITHUB_API_ERROR', message: `GitHub API error: ${(errorBody as any).message || response.status}` },
        };
      }

      const body = await response.json();
      const runs = Array.isArray((body as any).workflow_runs) ? (body as any).workflow_runs : [];
      this.logger.log(`Found ${runs.length} workflow runs on '${owner}/${repo}'`);
      return { success: true, output: runs.map((run: any) => this.mapWorkflowRun(run)) };
    } catch (error: any) {
      return { success: false, error: { code: 'GITHUB_API_ERROR', message: `GitHub API request failed: ${error.message}` } };
    }
  }
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
cd apps/backend && pnpm exec jest src/pipelines/handlers/github-api.handler.spec.ts
```

Expected: PASS, all tests green.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/pipelines/handlers/github-api.handler.ts apps/backend/src/pipelines/handlers/github-api.handler.spec.ts
git commit -m "feat(pipelines): add list_workflow_runs action to github_api"
```

---

### Task 2: `get_workflow_run` action

**Files:**
- Modify: `apps/backend/src/pipelines/handlers/github-api.handler.ts`
- Modify: `apps/backend/src/pipelines/handlers/github-api.handler.spec.ts`

**Interfaces:**
- Consumes: `mapWorkflowRun(run)` from Task 1; the `perPage`/`event`/`status` field group from Task 1.
- Produces: action union gains `'get_workflow_run'`; config gains `runId?: string`; private method `getWorkflowRun(config, context, step, token): Promise<StepResult>` whose `output` is a **single** mapped run object (same field set as Task 1's array elements).

- [ ] **Step 1: Write the failing test**

Add to `github-api.handler.spec.ts`, inside the top-level `describe('GitHubApiHandler')`:

```typescript
  describe('get_workflow_run', () => {
    it('requires owner, repo and runId', () => {
      expect(() =>
        handler.validateConfig({ action: 'get_workflow_run', owner: 'o', repo: 'r' } as never),
      ).toThrow(/runId/);
    });

    it('fetches a single run by id and maps it', async () => {
      mockFetch.mockResolvedValue(
        makeFetchResponse({ status: 200, body: { ...RUN_FIXTURE, status: 'completed', conclusion: 'success' } }),
      );

      const result = await handler.execute(
        makeContext(),
        makeStep({ action: 'get_workflow_run', owner: 'o', repo: 'r', runId: '42' }),
      );

      expect(result.success).toBe(true);
      expect(result.output).toMatchObject({ id: 42, status: 'completed', conclusion: 'success' });
      expect(mockFetch.mock.calls[0][0]).toBe('https://api.github.com/repos/o/r/actions/runs/42');
    });

    it('returns GITHUB_API_ERROR when the run is gone', async () => {
      mockFetch.mockResolvedValue(makeFetchResponse({ status: 404, body: { message: 'Not Found' } }));

      const result = await handler.execute(
        makeContext(),
        makeStep({ action: 'get_workflow_run', owner: 'o', repo: 'r', runId: '42' }),
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('GITHUB_API_ERROR');
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/backend && pnpm exec jest src/pipelines/handlers/github-api.handler.spec.ts -t get_workflow_run
```

Expected: FAIL with "Unknown action 'get_workflow_run'".

- [ ] **Step 3: Add the action and its config field**

Append `| 'get_workflow_run'` to the action union, and add to the workflow-run field group:

```typescript
  /** Workflow run id for get_workflow_run (expression) */
  runId?: string;
```

- [ ] **Step 4: Add validation**

Insert before the final `else` in `validateConfig`:

```typescript
    } else if (config.action === 'get_workflow_run') {
      if (!config.owner) {
        throw new ConfigurationError('owner is required for get_workflow_run', 'github_api');
      }
      if (!config.repo) {
        throw new ConfigurationError('repo is required for get_workflow_run', 'github_api');
      }
      if (!config.runId) {
        throw new ConfigurationError('runId is required for get_workflow_run', 'github_api');
      }
```

Extend the `Unknown action` message to end with `..., list_workflow_runs, get_workflow_run`.

- [ ] **Step 5: Wire the execute switch and implement**

In `execute()`:

```typescript
    if (config.action === 'get_workflow_run') {
      return this.getWorkflowRun(config, context, step, token);
    }
```

And the method, after `listWorkflowRuns`:

```typescript
  private async getWorkflowRun(
    config: GitHubApiHandlerConfig,
    context: PipelineContext,
    step: PipelineStep,
    token: string,
  ): Promise<StepResult> {
    const owner = String(this.expressionEvaluator.evaluateExpression(config.owner!, context, step.name));
    const repo = String(this.expressionEvaluator.evaluateExpression(config.repo!, context, step.name));
    const runId = String(this.expressionEvaluator.evaluateExpression(config.runId!, context, step.name));

    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/actions/runs/${runId}`;
    this.logger.debug(`Fetching workflow run '${runId}' on '${owner}/${repo}'`);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        return {
          success: false,
          error: { code: 'GITHUB_API_ERROR', message: `GitHub API error: ${(errorBody as any).message || response.status}` },
        };
      }

      const run = await response.json();
      return { success: true, output: this.mapWorkflowRun(run) };
    } catch (error: any) {
      return { success: false, error: { code: 'GITHUB_API_ERROR', message: `GitHub API request failed: ${error.message}` } };
    }
  }
```

- [ ] **Step 6: Run the full handler spec**

```bash
cd apps/backend && pnpm exec jest src/pipelines/handlers/github-api.handler.spec.ts
```

Expected: PASS, all tests including Task 1's.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/pipelines/handlers/github-api.handler.ts apps/backend/src/pipelines/handlers/github-api.handler.spec.ts
git commit -m "feat(pipelines): add get_workflow_run action to github_api"
```

---

### Task 3: Expose both actions to agents and the admin UI

Without this task the actions work but are invisible: MCP-authored rules won't know they exist, and the admin UI's action dropdown can't select them (a rule using them would render with an empty config form).

**Files:**
- Modify: `apps/backend/src/mcp/tools/proxy-rules.tools.ts:82` (after the `dispatch` doc line)
- Modify: `apps/frontend/src/components/pipelines/handlers/GitHubApiConfig.tsx` (the `SelectContent` list ~line 50, and a new config block after the `list_pull_requests` block ~line 265)

**Interfaces:**
- Consumes: the config field names from Tasks 1-2 — `owner`, `repo`, `event`, `status`, `perPage`, `runId`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the MCP documentation lines**

In `proxy-rules.tools.ts`, immediately after the `action "dispatch"` line, add:

```
  - action "list_workflow_runs": { action: "list_workflow_runs", owner: "expression", repo: "expression", event?: "expression (e.g. \"'repository_dispatch'\")", status?: "expression (e.g. \"'in_progress'\")", perPage?: number (1-100, default 30) }. Lists GitHub Actions runs, newest first. Use with a dispatch that sets run-name from a token, then match the token in display_title to find your run. Output: [{ id, name, display_title, status, conclusion, html_url, run_number, event, head_branch, created_at, updated_at }].
  - action "get_workflow_run": { action: "get_workflow_run", owner: "expression", repo: "expression", runId: "expression" }. Fetches one run by id — use after list_workflow_runs has resolved the id. Output: { id, name, display_title, status, conclusion, html_url, run_number, event, head_branch, created_at, updated_at }.
```

- [ ] **Step 2: Add the two dropdown entries**

In `GitHubApiConfig.tsx`, inside `<SelectContent>` after the `dispatch` item:

```tsx
            <SelectItem value="list_workflow_runs">List Workflow Runs</SelectItem>
            <SelectItem value="get_workflow_run">Get Workflow Run</SelectItem>
```

- [ ] **Step 3: Add the config fields block**

After the existing `{action === 'list_pull_requests' && (...)}` block:

```tsx
      {(action === 'list_workflow_runs' || action === 'get_workflow_run') && (
        <>
          <div className="space-y-2">
            <Label>Owner *</Label>
            <ExpressionInput
              value={(config.owner as string) || ''}
              onChange={(value) => onChange({ ...config, owner: value })}
              placeholder="bffless"
              previousSteps={previousSteps}
            />
            <p className="text-xs text-muted-foreground">Repository owner (org or user)</p>
          </div>
          <div className="space-y-2">
            <Label>Repo *</Label>
            <ExpressionInput
              value={(config.repo as string) || ''}
              onChange={(value) => onChange({ ...config, repo: value })}
              placeholder="studio-oneshot"
              previousSteps={previousSteps}
            />
          </div>
        </>
      )}

      {action === 'list_workflow_runs' && (
        <>
          <div className="space-y-2">
            <Label>Event</Label>
            <ExpressionInput
              value={(config.event as string) || ''}
              onChange={(value) => onChange({ ...config, event: value })}
              placeholder="repository_dispatch"
              previousSteps={previousSteps}
            />
            <p className="text-xs text-muted-foreground">
              Optional. Only return runs triggered by this event.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <ExpressionInput
              value={(config.status as string) || ''}
              onChange={(value) => onChange({ ...config, status: value })}
              placeholder="in_progress"
              previousSteps={previousSteps}
            />
            <p className="text-xs text-muted-foreground">
              Optional. GitHub status or conclusion, e.g. queued, in_progress, completed, success.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Per page</Label>
            <input
              type="number"
              min={1}
              max={100}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={(config.perPage as number) ?? 30}
              onChange={(e) => onChange({ ...config, perPage: Number(e.target.value) })}
            />
            <p className="text-xs text-muted-foreground">1-100. Newest runs first.</p>
          </div>
        </>
      )}

      {action === 'get_workflow_run' && (
        <div className="space-y-2">
          <Label>Run ID *</Label>
          <ExpressionInput
            value={(config.runId as string) || ''}
            onChange={(value) => onChange({ ...config, runId: value })}
            placeholder="steps.load_run.github_run_id"
            previousSteps={previousSteps}
          />
          <p className="text-xs text-muted-foreground">
            The GitHub run id, usually stored from an earlier list_workflow_runs match.
          </p>
        </div>
      )}
```

- [ ] **Step 4: Verify the backend still builds and the frontend lints**

```bash
cd apps/backend && pnpm build
cd ../frontend && pnpm lint
```

Expected: backend build succeeds. For the frontend, `lint` already reports pre-existing problems on `main` — compare the count against `main` and confirm you added none. Do not attempt to fix unrelated pre-existing lint errors in this PR.

- [ ] **Step 5: Run the full backend handler test suite**

```bash
cd apps/backend && pnpm exec jest src/pipelines/handlers
```

Expected: PASS — confirms nothing in the shared handler directory regressed.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/mcp/tools/proxy-rules.tools.ts apps/frontend/src/components/pipelines/handlers/GitHubApiConfig.tsx
git commit -m "feat(pipelines): surface workflow-run actions in MCP docs and admin UI"
```

---

### Task 4: Open the PR

**Files:** none (repo operation only).

**Interfaces:**
- Consumes: all three prior tasks' commits.
- Produces: a merged CE release carrying both actions — the gate the Studio One-Shot status view waits on.

- [ ] **Step 1: Push the branch**

```bash
git push -u origin <branch-name>
```

- [ ] **Step 2: Open the PR with a conventional-commit title**

The title becomes the squashed commit and drives release-please, so it must be conventional:

```bash
gh pr create --title "feat(pipelines): read GitHub Actions run status from github_api" --body-file - <<'EOF'
Adds two read actions to the `github_api` handler so a pipeline can follow a
workflow run it dispatched:

- `list_workflow_runs` — list runs, optionally filtered by `event` / `status`
- `get_workflow_run` — fetch one run by id

Both use the project's existing GitHub integration credential, mirroring
`list_pull_requests`. No new credential path and no schema change.

Also adds `github-api.handler.spec.ts`, which did not exist — the handler
shipped untested while its neighbours (`http-request`, `signed-url`,
`presigned-upload`) all have specs. The new file covers both actions plus a
regression test for the existing `dispatch` action.

Motivation: Studio One-Shot (`bffless/studio-oneshot`) dispatches a workflow
from a pipeline and needs to show its status. The alternative was a raw
`http_request` with a second copy of the PAT in project secrets — one
credential in two places, silently drifting. Extending the handler keeps a
single GitHub credential in a single home.
EOF
```

Note `--body-file -` for a heredoc body; `--body -` writes a literal `-`.

- [ ] **Step 3: Report the PR URL and stop**

Do not merge. The user merges and releases CE, then upgrades `bffless.dev`, before the Studio One-Shot status view is deployed.

---

## Self-Review

**Spec coverage:** The spec's "CE dependency" section names `list_workflow_runs` (Task 1), `get_workflow_run` (Task 2), and four registration points — handler (Tasks 1-2), MCP docs (Task 3), admin UI (Task 3), and the missing spec file (Task 1 creates it). The output shapes in the spec's table match the `mapWorkflowRun` field list. Covered.

**Placeholder scan:** No TBD/TODO. Every code step carries the literal code. The one judgement call — frontend lint having pre-existing failures — is stated with the exact comparison to make rather than left as "handle errors".

**Type consistency:** `mapWorkflowRun` is defined in Task 1 and consumed by Task 2. Config field names (`owner`, `repo`, `event`, `status`, `perPage`, `runId`) are identical across the handler, the MCP doc lines, and the UI block. The action strings `list_workflow_runs` / `get_workflow_run` are spelled identically in the union, both `validateConfig` branches, both `execute` branches, the MCP docs, and the `SelectItem` values.
