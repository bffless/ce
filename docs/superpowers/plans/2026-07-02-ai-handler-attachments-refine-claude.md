# AI Handler Attachments + Claude Scene Refiner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give CE's `ai_handler` (completion mode) an `attachments` config so pipelines can send images to Claude, then create a `/api/refine-scene-claude` pipeline on the j5s instance that refines Studio scenes via Anthropic instead of Replicate/Gemini.

**Architecture:** A pure helper (`buildAttachmentParts`) resolves attachment config entries (expression → URL or URL[]) into AI SDK image/file parts; `AIHandler.execute` swaps the completion-mode user message from a string to multi-part content when any parts resolve. The pipeline editor UI and MCP tool docs learn the new field so config round-trips. The new pipeline is a copy of `/api/refine-scene` with audio removed and the `replicate` step replaced by `ai_handler`.

**Tech Stack:** NestJS, Vercel AI SDK (`ai`, `@ai-sdk/anthropic`), Jest, React + shadcn/Radix (pipeline editor), BFFless MCP (`bffless-j5s`).

**Spec:** `docs/superpowers/specs/2026-07-02-ai-handler-attachments-refine-claude-design.md`

## Global Constraints

- Repo rule: **never commit without explicit user approval** — at each commit step, ask the user first (a single upfront "commit as you go" approval covers the whole plan). Never force-push; never amend pushed commits.
- The workspace root (`~/projects/sahp`) is NOT a git repo — all git commands run inside `~/projects/sahp/ce`.
- Conventional commits: only `feat:`/`fix:` trigger the CE release pipeline. The final PR/merge commit must be `feat:` so a release is cut.
- Attachments are **completion mode only**; chat mode ignores them.
- With zero resolved attachments, completion behavior must be byte-for-byte today's (plain string content) — regression guard test required.
- Attachment URLs are passed through to the provider (no downloading/base64 in CE).
- Tasks 1–6 are the CE change. Task 7–8 run **only after** the CE release is deployed to the j5s workspace.

---

### Task 1: `buildAttachmentParts` util (TDD)

**Files:**
- Create: `apps/backend/src/pipelines/handlers/ai-attachments.util.ts`
- Test: `apps/backend/src/pipelines/handlers/ai-attachments.util.spec.ts`

**Interfaces:**
- Consumes: nothing (pure function).
- Produces: `AIAttachmentConfig { type: 'image' | 'file'; source: string; mediaType?: string }` and `buildAttachmentParts(attachments: AIAttachmentConfig[], resolveSource: (expression: string) => unknown): Array<ImagePart | FilePart>` — Task 2 adds the type to the config interface; Task 3 calls the function from `AIHandler`.

- [ ] **Step 1: Create the feature branch**

```bash
cd ~/projects/sahp/ce && git checkout main && git pull && git checkout -b feat/ai-handler-attachments
```

- [ ] **Step 2: Write the failing test**

Create `apps/backend/src/pipelines/handlers/ai-attachments.util.spec.ts`:

```ts
import { buildAttachmentParts, AIAttachmentConfig } from './ai-attachments.util';

describe('buildAttachmentParts', () => {
  const resolveWith = (values: Record<string, unknown>) => (expr: string) => values[expr];

  it('fans an array source out into one image part per URL', () => {
    const attachments: AIAttachmentConfig[] = [{ type: 'image', source: 'steps.collect.images' }];
    const parts = buildAttachmentParts(
      attachments,
      resolveWith({
        'steps.collect.images': ['https://x.test/a.png', 'https://x.test/b.png'],
      }),
    );

    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ type: 'image', image: new URL('https://x.test/a.png') });
    expect(parts[1]).toEqual({ type: 'image', image: new URL('https://x.test/b.png') });
  });

  it('treats a single string source as one image part', () => {
    const parts = buildAttachmentParts(
      [{ type: 'image', source: 'steps.sign0.url' }],
      resolveWith({ 'steps.sign0.url': 'https://x.test/a.png' }),
    );

    expect(parts).toEqual([{ type: 'image', image: new URL('https://x.test/a.png') }]);
  });

  it('skips null, undefined, empty-string, and non-string values silently', () => {
    const parts = buildAttachmentParts(
      [
        { type: 'image', source: 'steps.a.url' },
        { type: 'image', source: 'steps.b.url' },
        { type: 'image', source: 'steps.c.urls' },
      ],
      resolveWith({
        'steps.a.url': null,
        'steps.b.url': '',
        'steps.c.urls': ['https://x.test/ok.png', undefined, 42, '   '],
      }),
    );

    expect(parts).toEqual([{ type: 'image', image: new URL('https://x.test/ok.png') }]);
  });

  it('returns [] when every source resolves empty', () => {
    const parts = buildAttachmentParts(
      [{ type: 'image', source: 'steps.a.url' }],
      resolveWith({ 'steps.a.url': undefined }),
    );
    expect(parts).toEqual([]);
  });

  it('builds file parts with mediaType', () => {
    const parts = buildAttachmentParts(
      [{ type: 'file', source: 'steps.signAudio.url', mediaType: 'audio/mpeg' }],
      resolveWith({ 'steps.signAudio.url': 'https://x.test/scene.mp3' }),
    );

    expect(parts).toEqual([
      { type: 'file', data: new URL('https://x.test/scene.mp3'), mediaType: 'audio/mpeg' },
    ]);
  });

  it('throws a descriptive error for a value that is not a valid absolute URL', () => {
    expect(() =>
      buildAttachmentParts(
        [{ type: 'image', source: 'steps.a.url' }],
        resolveWith({ 'steps.a.url': 'not-a-url' }),
      ),
    ).toThrow(/steps\.a\.url.*not-a-url/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd ~/projects/sahp/ce/apps/backend && pnpm test -- ai-attachments.util
```

Expected: FAIL — cannot find module `./ai-attachments.util`.

- [ ] **Step 4: Write the implementation**

Create `apps/backend/src/pipelines/handlers/ai-attachments.util.ts`:

```ts
import type { FilePart, ImagePart } from 'ai';

/**
 * Attachment entry on an ai_handler step config (completion mode only).
 */
export interface AIAttachmentConfig {
  /** 'image' for vision inputs; 'file' for other media (requires mediaType). */
  type: 'image' | 'file';
  /**
   * Expression resolving to a URL string or an array of URL strings
   * (e.g. "steps.collect.images"). Arrays fan out into one part per element.
   */
  source: string;
  /** MIME type for 'file' attachments (e.g. "audio/mpeg"). */
  mediaType?: string;
}

/**
 * Resolve ai_handler attachment configs into AI SDK message parts.
 *
 * Empty, null, and non-string resolved values are skipped silently so
 * conditional attachments (e.g. optional signed-url steps) just work.
 * URLs are passed through for the provider to fetch — no bytes move
 * through CE.
 */
export function buildAttachmentParts(
  attachments: AIAttachmentConfig[],
  resolveSource: (expression: string) => unknown,
): Array<ImagePart | FilePart> {
  const parts: Array<ImagePart | FilePart> = [];

  for (const attachment of attachments) {
    const resolved = resolveSource(attachment.source);
    const values = Array.isArray(resolved) ? resolved : [resolved];

    for (const value of values) {
      if (typeof value !== 'string' || value.trim() === '') {
        continue;
      }

      let url: URL;
      try {
        url = new URL(value);
      } catch {
        throw new Error(
          `Attachment source '${attachment.source}' resolved to an invalid URL: ${value}`,
        );
      }

      if (attachment.type === 'image') {
        parts.push({ type: 'image', image: url });
      } else {
        parts.push({ type: 'file', data: url, mediaType: attachment.mediaType ?? '' });
      }
    }
  }

  return parts;
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd ~/projects/sahp/ce/apps/backend && pnpm test -- ai-attachments.util
```

Expected: PASS (6 tests).

- [ ] **Step 6: Commit (ask user first per repo rule)**

```bash
cd ~/projects/sahp/ce && git add apps/backend/src/pipelines/handlers/ai-attachments.util.ts apps/backend/src/pipelines/handlers/ai-attachments.util.spec.ts && git commit -m "feat: add ai_handler attachment part builder"
```

---

### Task 2: Config type + `validateConfig` (TDD)

**Files:**
- Modify: `apps/backend/src/pipelines/execution/step-handler.interface.ts` (inside `AIHandlerConfig`, after the `messageField` JSDoc block ~line 374)
- Modify: `apps/backend/src/pipelines/handlers/ai.handler.ts` (`validateConfig`, ~line 50-103)
- Test: `apps/backend/src/pipelines/handlers/ai.handler.spec.ts` (new file)

**Interfaces:**
- Consumes: `AIAttachmentConfig` from Task 1 (`./ai-attachments.util`).
- Produces: `AIHandlerConfig.attachments?: AIAttachmentConfig[]` — Task 3 reads it in `execute`; Task 5 mirrors it in the frontend types.

- [ ] **Step 1: Write the failing tests**

Create `apps/backend/src/pipelines/handlers/ai.handler.spec.ts`:

```ts
import { AIHandler } from './ai.handler';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { AIHandlerConfig } from '../execution/step-handler.interface';

// Mock the AI SDK so importing/executing the handler never hits the network.
jest.mock('ai', () => ({
  generateText: jest.fn(),
  streamText: jest.fn(),
  stepCountIs: jest.fn(() => 'stepCountIs'),
}));
jest.mock('@ai-sdk/openai', () => ({ createOpenAI: jest.fn(() => jest.fn(() => 'openai-model')) }));
jest.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: jest.fn(() => jest.fn(() => 'anthropic-model')),
}));
jest.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: jest.fn(() => jest.fn(() => 'google-model')),
}));

export function createHandler(overrides: Partial<Record<string, unknown>> = {}) {
  const registry = { register: jest.fn() };
  const projectAISettingsService = {
    getProviderConfig: jest.fn().mockResolvedValue({
      provider: 'anthropic',
      apiKey: 'test-key',
      defaultModel: 'claude-sonnet-4-6',
    }),
    resolveSkillsCommitSha: jest.fn().mockResolvedValue(null),
    getSkillsPath: jest.fn().mockResolvedValue('skills'),
    ...((overrides.projectAISettingsService as object) || {}),
  };
  const handler = new AIHandler(
    registry as never,
    new ExpressionEvaluator(),
    projectAISettingsService as never,
    {} as never, // PipelineDataService
    {} as never, // PipelineSchemasService
    { listSkills: jest.fn().mockResolvedValue([]) } as never, // SkillsService
    {} as never, // AIToolPluginService
  );
  return { handler, projectAISettingsService };
}

describe('AIHandler.validateConfig — attachments', () => {
  const { handler } = createHandler();

  const base: AIHandlerConfig = { mode: 'completion' };

  it('accepts a valid image attachment', () => {
    expect(() =>
      handler.validateConfig({
        ...base,
        attachments: [{ type: 'image', source: 'steps.collect.images' }],
      }),
    ).not.toThrow();
  });

  it('accepts a valid file attachment with mediaType', () => {
    expect(() =>
      handler.validateConfig({
        ...base,
        attachments: [{ type: 'file', source: 'steps.signAudio.url', mediaType: 'audio/mpeg' }],
      }),
    ).not.toThrow();
  });

  it('rejects a non-array attachments value', () => {
    expect(() =>
      handler.validateConfig({ ...base, attachments: 'nope' as never }),
    ).toThrow(/attachments must be an array/);
  });

  it('rejects an invalid attachment type', () => {
    expect(() =>
      handler.validateConfig({
        ...base,
        attachments: [{ type: 'video' as never, source: 'steps.a.url' }],
      }),
    ).toThrow(/Invalid attachment type/);
  });

  it('rejects an empty source', () => {
    expect(() =>
      handler.validateConfig({ ...base, attachments: [{ type: 'image', source: '  ' }] }),
    ).toThrow(/source must be a non-empty string/);
  });

  it("rejects type 'file' without mediaType", () => {
    expect(() =>
      handler.validateConfig({ ...base, attachments: [{ type: 'file', source: 'steps.a.url' }] }),
    ).toThrow(/mediaType is required/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/projects/sahp/ce/apps/backend && pnpm test -- ai.handler.spec
```

Expected: FAIL — TS error `attachments` not in `AIHandlerConfig`, and/or `not.toThrow` assertions pass but reject-cases fail because no validation exists.

- [ ] **Step 3: Add `attachments` to `AIHandlerConfig`**

In `apps/backend/src/pipelines/execution/step-handler.interface.ts`, add an import at the top of the file:

```ts
import type { AIAttachmentConfig } from '../handlers/ai-attachments.util';
```

Then inside `interface AIHandlerConfig`, directly after the `messageField?: string;` member and its JSDoc, add:

```ts
  /**
   * [Completion mode only]
   * Attachments to include with the user message. Each source is an
   * expression that resolves to a URL string or an array of URL strings
   * (e.g. "steps.collect.images"). Arrays fan out into one content part
   * per element; empty/null resolved values are skipped silently.
   * Chat mode ignores this field.
   */
  attachments?: AIAttachmentConfig[];
```

- [ ] **Step 4: Add validation in `ai.handler.ts`**

In `validateConfig` (after the provider check, before the persistence check), add:

```ts
    if (config.attachments !== undefined) {
      if (!Array.isArray(config.attachments)) {
        throw new ConfigurationError('attachments must be an array', 'ai_handler');
      }
      for (const attachment of config.attachments) {
        if (!attachment || !['image', 'file'].includes(attachment.type)) {
          throw new ConfigurationError(
            `Invalid attachment type: ${attachment?.type}. Must be 'image' or 'file'.`,
            'ai_handler',
          );
        }
        if (typeof attachment.source !== 'string' || attachment.source.trim() === '') {
          throw new ConfigurationError(
            'Attachment source must be a non-empty string expression',
            'ai_handler',
          );
        }
        if (attachment.type === 'file' && !attachment.mediaType) {
          throw new ConfigurationError(
            "Attachment mediaType is required when type is 'file'",
            'ai_handler',
          );
        }
      }
    }
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd ~/projects/sahp/ce/apps/backend && pnpm test -- ai.handler.spec
```

Expected: PASS (6 tests).

- [ ] **Step 6: Commit (ask user first per repo rule)**

```bash
cd ~/projects/sahp/ce && git add apps/backend/src/pipelines/execution/step-handler.interface.ts apps/backend/src/pipelines/handlers/ai.handler.ts apps/backend/src/pipelines/handlers/ai.handler.spec.ts && git commit -m "feat: validate ai_handler attachments config"
```

---

### Task 3: Wire attachments into completion mode (TDD)

**Files:**
- Modify: `apps/backend/src/pipelines/handlers/ai.handler.ts` (completion-mode message build, the `messages.push({ role: 'user', content: userMessage });` at ~line 266)
- Test: `apps/backend/src/pipelines/handlers/ai.handler.spec.ts` (extend)

**Interfaces:**
- Consumes: `buildAttachmentParts` from Task 1; `config.attachments` from Task 2.
- Produces: completion-mode user message with `content: [{type:'text',...}, ...ImagePart|FilePart]` when attachments resolve; unchanged string content otherwise. New failure code `ATTACHMENT_ERROR` on invalid URLs.

- [ ] **Step 1: Write the failing tests**

Append to `apps/backend/src/pipelines/handlers/ai.handler.spec.ts`:

```ts
import { generateText } from 'ai';
import { PipelineContext } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';

function createContext(stepOutputs: Record<string, unknown>): PipelineContext {
  return {
    request: { body: {} } as never,
    stepOutputs,
    projectId: 'proj-1',
    pipelineId: 'pipe-1',
    metadata: { path: '/x', method: 'POST', headers: {}, query: {}, body: {} },
  } as PipelineContext;
}

function completionStep(config: Record<string, unknown>): PipelineStep {
  return {
    id: 'refiner',
    name: 'refiner',
    handlerType: 'ai_handler',
    config: {
      mode: 'completion',
      responseMode: 'message',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      skills: { mode: 'none' },
      ...config,
    },
  } as PipelineStep;
}

describe('AIHandler.execute — completion attachments', () => {
  beforeEach(() => {
    (generateText as jest.Mock).mockReset().mockResolvedValue({
      text: 'ok',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      finishReason: 'stop',
      steps: [],
    });
  });

  it('sends multi-part content: text part first, one image part per URL', async () => {
    const { handler } = createHandler();
    const context = createContext({
      prep: { prompt: 'refine this' },
      collect: { images: ['https://x.test/a.png', 'https://x.test/b.png'] },
    });

    const result = await handler.execute(
      context,
      completionStep({
        messageField: 'steps.prep.prompt',
        attachments: [{ type: 'image', source: 'steps.collect.images' }],
      }),
    );

    expect(result.success).toBe(true);
    const { messages } = (generateText as jest.Mock).mock.calls[0][0];
    const userMessage = messages.find((m: { role: string }) => m.role === 'user');
    expect(userMessage.content).toEqual([
      { type: 'text', text: 'refine this' },
      { type: 'image', image: new URL('https://x.test/a.png') },
      { type: 'image', image: new URL('https://x.test/b.png') },
    ]);
  });

  it('keeps plain string content when no attachments are configured (regression)', async () => {
    const { handler } = createHandler();
    const context = createContext({ prep: { prompt: 'refine this' } });

    await handler.execute(context, completionStep({ messageField: 'steps.prep.prompt' }));

    const { messages } = (generateText as jest.Mock).mock.calls[0][0];
    const userMessage = messages.find((m: { role: string }) => m.role === 'user');
    expect(userMessage.content).toBe('refine this');
  });

  it('keeps plain string content when all attachment sources resolve empty', async () => {
    const { handler } = createHandler();
    const context = createContext({ prep: { prompt: 'refine this' }, collect: { images: [] } });

    await handler.execute(
      context,
      completionStep({
        messageField: 'steps.prep.prompt',
        attachments: [{ type: 'image', source: 'steps.collect.images' }],
      }),
    );

    const { messages } = (generateText as jest.Mock).mock.calls[0][0];
    const userMessage = messages.find((m: { role: string }) => m.role === 'user');
    expect(userMessage.content).toBe('refine this');
  });

  it('fails with ATTACHMENT_ERROR when a source resolves to an invalid URL', async () => {
    const { handler } = createHandler();
    const context = createContext({
      prep: { prompt: 'refine this' },
      collect: { images: ['not-a-url'] },
    });

    const result = await handler.execute(
      context,
      completionStep({
        messageField: 'steps.prep.prompt',
        attachments: [{ type: 'image', source: 'steps.collect.images' }],
      }),
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('ATTACHMENT_ERROR');
    expect(generateText).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

```bash
cd ~/projects/sahp/ce/apps/backend && pnpm test -- ai.handler.spec
```

Expected: the two attachment-content tests FAIL (content is still a plain string / no ATTACHMENT_ERROR); regression tests PASS.

- [ ] **Step 3: Wire the util into `execute`**

In `apps/backend/src/pipelines/handlers/ai.handler.ts`:

Add the import near the other local imports:

```ts
import { buildAttachmentParts } from './ai-attachments.util';
```

Replace the single line `messages.push({ role: 'user', content: userMessage });` (end of the completion-mode branch) with:

```ts
      let userContent: ModelMessage['content'] = userMessage;
      if (config.attachments?.length) {
        try {
          const attachmentParts = buildAttachmentParts(config.attachments, (expression) =>
            this.expressionEvaluator.evaluateExpression(expression, context, stepName),
          );
          if (attachmentParts.length > 0) {
            userContent = [{ type: 'text', text: userMessage }, ...attachmentParts];
          }
        } catch (error) {
          return {
            success: false,
            error: {
              code: 'ATTACHMENT_ERROR',
              message: error.message || 'Failed to resolve attachments',
              details: { step: stepName },
            },
          };
        }
      }

      messages.push({ role: 'user', content: userContent } as ModelMessage);
```

Note: `ModelMessage['content']` covers the multi-part union; the cast on push keeps TS happy about the role/content pairing.

- [ ] **Step 4: Run the full backend pipeline tests**

```bash
cd ~/projects/sahp/ce/apps/backend && pnpm test -- ai.handler.spec && pnpm test -- ai-attachments.util
```

Expected: ALL PASS.

- [ ] **Step 5: Backend typecheck**

```bash
cd ~/projects/sahp/ce && pnpm --filter backend exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit (ask user first per repo rule)**

```bash
cd ~/projects/sahp/ce && git add apps/backend/src/pipelines/handlers/ai.handler.ts apps/backend/src/pipelines/handlers/ai.handler.spec.ts && git commit -m "feat: send ai_handler attachments as multi-part user content"
```

---

### Task 4: MCP tool documentation

**Files:**
- Modify: `apps/backend/src/mcp/tools/proxy-rules.tools.ts:60` (the `- ai_handler:` line in the step-config description; it appears once in a shared description constant used by both create/update tools — verify with grep and update every occurrence if there are more)

**Interfaces:**
- Consumes: config shape from Task 2.
- Produces: MCP clients see `attachments` documented on ai_handler.

- [ ] **Step 1: Locate every occurrence**

```bash
cd ~/projects/sahp/ce && grep -rn '"expression for user message content' apps/backend/src/mcp/
```

Expected: 1 match at `apps/backend/src/mcp/tools/proxy-rules.tools.ts:60` (if more, apply the same edit to each).

- [ ] **Step 2: Update the ai_handler doc line**

In the `- ai_handler: { ... }` line, after `messageField: "..." (NOT userPrompt),` insert:

```
attachments?: [{ type: "image"|"file", source: "expression resolving to a URL or ARRAY of URLs (e.g. steps.collect.images) — arrays fan out to one part per URL, empty values skipped", mediaType?: "required for file (e.g. audio/mpeg)" }] (completion mode only; images work on all providers, files/audio NOT on anthropic),
```

so the line reads:

```
- ai_handler: { provider: "anthropic"|"openai", model: "model-id (MUST be literal string, does NOT support expressions)", systemPrompt?: "text", messageField: "expression for user message content (e.g. request.body.prompt, steps.prep.message)" (NOT userPrompt), attachments?: [{ type: "image"|"file", source: "expression resolving to a URL or ARRAY of URLs (e.g. steps.collect.images) — arrays fan out to one part per URL, empty values skipped", mediaType?: "required for file (e.g. audio/mpeg)" }] (completion mode only; images work on all providers, files/audio NOT on anthropic), temperature?: number }. OUTPUT: access AI response via steps.stepName.content (NOT .messageField). Available models: claude-haiku-4-5, claude-sonnet-4-6, claude-opus-4-6. Conditions on ai_handler steps cannot use inline === comparisons — compute booleans in a prior function_handler and reference them.
```

- [ ] **Step 3: Typecheck**

```bash
cd ~/projects/sahp/ce && pnpm --filter backend exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit (ask user first per repo rule)**

```bash
cd ~/projects/sahp/ce && git add apps/backend/src/mcp/tools/proxy-rules.tools.ts && git commit -m "feat: document ai_handler attachments in MCP step config"
```

---

### Task 5: Pipeline editor UI

**Files:**
- Modify: `apps/frontend/src/components/pipelines/handlers/types.ts` (inside `AIHandlerConfig`, after `messageField`)
- Modify: `apps/frontend/src/components/pipelines/handlers/AIHandlerConfig.tsx` (state ~line 130, onChange rebuild ~line 254-278, completion-mode JSX ~line 503-551)

**Interfaces:**
- Consumes: config shape from Task 2 (must serialize identically: `{ type, source, mediaType? }`).
- Produces: `attachments` round-trips through UI edits; omitted (`undefined`) when list is empty or mode is chat.

Notes for the implementer: `Select/SelectTrigger/SelectValue/SelectContent/SelectItem` (from `@/components/ui/select`), `Input`, `Button`, `Plus`, `Trash2`, `ExpressionInput`, `Tooltip*`, and `Label` are **already imported** in this file. The component receives `previousSteps` as a prop.

- [ ] **Step 1: Add the type**

In `types.ts`, inside `AIHandlerConfig` directly after the `messageField?: string;` line, add:

```ts
  /**
   * [Completion mode] Attachments for the user message. Each source is an
   * expression resolving to a URL or an array of URLs (arrays fan out into
   * one part per URL). mediaType is required for type 'file'.
   */
  attachments?: Array<{ type: 'image' | 'file'; source: string; mediaType?: string }>;
```

- [ ] **Step 2: Add state + row handlers**

In `AIHandlerConfig.tsx`, after the `const [messageField, setMessageField] = ...` line (~line 130), add:

```tsx
  const [attachments, setAttachments] = useState<
    Array<{ type: 'image' | 'file'; source: string; mediaType: string }>
  >(() =>
    (config.attachments || []).map((a) => ({
      type: a.type,
      source: a.source,
      mediaType: a.mediaType || '',
    })),
  );

  const addAttachment = () =>
    setAttachments((prev) => [...prev, { type: 'image', source: '', mediaType: '' }]);
  const removeAttachment = (index: number) =>
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  const handleAttachmentChange = (
    index: number,
    patch: Partial<{ type: 'image' | 'file'; source: string; mediaType: string }>,
  ) => setAttachments((prev) => prev.map((a, i) => (i === index ? { ...a, ...patch } : a)));
```

- [ ] **Step 3: Include attachments in the onChange config rebuild**

In the `useEffect` that calls `onChangeRef.current({...})` (~line 241): before the call, add:

```tsx
    const cleanedAttachments = attachments
      .filter((a) => a.source.trim())
      .map((a) => ({
        type: a.type,
        source: a.source.trim(),
        ...(a.type === 'file' && a.mediaType.trim() ? { mediaType: a.mediaType.trim() } : {}),
      }));
```

Inside the object passed to `onChangeRef.current`, after the `messageField:` line, add:

```tsx
      attachments:
        mode === 'completion' && cleanedAttachments.length > 0 ? cleanedAttachments : undefined,
```

Add `attachments` to the effect's dependency array (append to the existing list ending `..., skills, plugins]`).

- [ ] **Step 4: Add the Attachments section to the completion-mode JSX**

The completion branch currently renders a single `<div className="space-y-2">` (the Message editor). Wrap it in a fragment and append the Attachments section as a sibling:

```tsx
        {mode === 'completion' ? (
          <>
            {/* (existing Message editor div — unchanged) */}
            <div className="space-y-2">
              {/* ... existing Message Label/Tooltip/Editor/help text ... */}
            </div>

            {/* Attachments */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label>Attachments</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" className="cursor-help">
                      <HelpCircle className="h-4 w-4 text-muted-foreground" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p>
                      Attach images or files to the message. Source is an expression that
                      resolves to a URL or an array of URLs (e.g.{' '}
                      <code>steps.collect.images</code>) — arrays send one attachment per URL.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </div>
              {attachments.map((att, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Select
                    value={att.type}
                    onValueChange={(value) =>
                      handleAttachmentChange(index, { type: value as 'image' | 'file' })
                    }
                  >
                    <SelectTrigger className="w-[110px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="image">Image</SelectItem>
                      <SelectItem value="file">File</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="flex-1">
                    <ExpressionInput
                      value={att.source}
                      onChange={(value) => handleAttachmentChange(index, { source: value })}
                      placeholder="steps.collect.images"
                      previousSteps={previousSteps}
                    />
                  </div>
                  {att.type === 'file' && (
                    <Input
                      value={att.mediaType}
                      onChange={(e) => handleAttachmentChange(index, { mediaType: e.target.value })}
                      placeholder="audio/mpeg"
                      className="w-[130px]"
                    />
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeAttachment(index)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addAttachment}>
                <Plus className="h-4 w-4 mr-1" /> Add attachment
              </Button>
            </div>
          </>
        ) : (
```

- [ ] **Step 5: Typecheck + lint the frontend**

```bash
cd ~/projects/sahp/ce && pnpm --filter frontend exec tsc --noEmit && pnpm --filter frontend lint
```

Expected: no errors (pre-existing lint warnings unrelated to this file are acceptable).

- [ ] **Step 6: Manual UI smoke test**

Run `pnpm dev:full` (or the already-running dev stack), open a pipeline with an ai_handler completion step, and verify: Attachments section renders, adding a row with source `steps.collect.images` persists after save/reopen, deleting the row removes `attachments` from the saved config.

- [ ] **Step 7: Commit (ask user first per repo rule)**

```bash
cd ~/projects/sahp/ce && git add apps/frontend/src/components/pipelines/handlers/types.ts apps/frontend/src/components/pipelines/handlers/AIHandlerConfig.tsx && git commit -m "feat: attachments editor for ai_handler pipeline steps"
```

---

### Task 6: Full verification + PR

**Files:** none new.

- [ ] **Step 1: Run the full test suites**

```bash
cd ~/projects/sahp/ce && pnpm --filter backend exec tsc --noEmit && pnpm --filter frontend exec tsc --noEmit && cd apps/backend && pnpm test
```

Expected: typechecks clean; backend tests all pass.

- [ ] **Step 2: Push branch + open PR (ask user first)**

```bash
cd ~/projects/sahp/ce && git push -u origin feat/ai-handler-attachments && gh pr create --title "feat: ai_handler attachments (multi-part image/file content)" --body "Adds an attachments config to ai_handler completion mode ... (summarize spec; link docs/superpowers/specs/2026-07-02-ai-handler-attachments-refine-claude-design.md)"
```

- [ ] **Step 3: After merge — confirm release + deploy to j5s**

Merging to main triggers the CE release pipeline (`feat:` commit required). Then update the j5s workspace to the released image (user-driven; identify the workspace with `ENV_FILE=.env.prod pnpm cli ls` from `platform/adapters`, then `ENV_FILE=.env.prod pnpm cli pull <workspace-id>` or a direct `helm upgrade ... --set image.tag=vX.Y.Z`). Verify the new image is serving before Task 7.

---

### Task 7: Create `/api/refine-scene-claude` pipeline (post-deploy, via `bffless-j5s` MCP)

**Files:** none in-repo (live pipeline on j5s). Rule set: `591dab6e-51cf-4d15-8b04-36b50f5d8c6d`. Source rule: `fd3b5c8f-c84c-4a68-a77b-7e8c8faf3796`.

**Interfaces:**
- Consumes: deployed ai_handler `attachments` support (Tasks 1–6).
- Produces: `POST /api/refine-scene-claude` — same request/response contract as `/api/refine-scene` except `audioUrl` is optional/ignored. Response `{ jobId, status: "pending" }`; job rows in schema `46f5eef6-cabe-48cf-95f8-05c9b94de2a7` with `kind: 'refine'`.

- [ ] **Step 1: Fetch the source rule as the base**

Call `mcp__bffless-j5s__get_proxy_rule` with id `fd3b5c8f-c84c-4a68-a77b-7e8c8faf3796` and save the `pipelineConfig` JSON to the scratchpad. The new rule copies it verbatim EXCEPT the deltas in Steps 2–5.

- [ ] **Step 2: New `prep` step code (replaces the original `prep` config.code)**

The complete new function — identical to the original except: (a) the `audioUrl`/`audioPath` block is deleted, (b) sys intro no longer mentions audio, (c) the whole `AUDIO:` paragraph is deleted, (d) the "attached audio" line in the prompt is deleted:

```js
function handler({ request, deployment }) {
  function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : 0 }
  var NL = String.fromCharCode(10)
  var body = (request && request.body) || {}
  var urls = body.sheetUrls
  if (!urls || typeof urls.length !== 'number') urls = []
  var prefix = deployment.owner + '/' + deployment.repo + '/uploads/'
  var out = {}
  for (var i = 0; i < 10; i++) {
    var p = ''
    if (i < urls.length && urls[i]) {
      var key = String(urls[i])
      while (key.charAt(0) === '/') { key = key.slice(1) }
      if (key.indexOf('api/uploads/') === 0) { key = key.slice(12) }
      p = prefix + key
    }
    out['path' + i] = p
  }

  var start = num(body.start)
  var end = num(body.end)
  if (end <= start) { end = start + 0.05 }
  var wordTimings = typeof body.wordTimings === 'string' ? body.wordTimings : ''
  var direction = typeof body.direction === 'string' ? body.direction.trim() : ''
  var directorDirection = typeof body.directorDirection === 'string' ? body.directorDirection.trim() : ''
  var sceneNumber = num(body.sceneNumber)
  var sceneCount = num(body.sceneCount)
  var previousContext = typeof body.previousContext === 'string' ? body.previousContext.trim() : ''

  var sys = ''
  sys += "You are the Scene Editor: an expert film and YouTube editor cutting ONE scene of a longer talk down to a tight, watchable take. There is NO first-pass script - you build the tightened cut from scratch." + NL
  sys += "You are given (1) the scene WORD TIMINGS - every spoken word with its exact start and end time in seconds, and (2) contact-sheet images sampled DENSELY across just this scene, each frame with its wall-clock timestamp burned into a corner. Use the words AND the frames." + NL + NL
  sys += "Decide precisely:" + NL
  sys += "1. segments: the tightened narration laid onto the original-video timeline as one or more runs, each {text, start, end} in seconds. Use MORE THAN ONE segment when a kept pause or held beat of silence should separate two runs of speech - each segment is one continuous run of narration and the gaps between segments are intentional kept silence. Keep the speaker's points and voice; cut filler, rambling, repeated takes and false starts. For each segment also return source: \"original\" when that segment should be voiced by the recording's own audio for its span, \"revoice\" when its text is new narration to be re-voiced. Set start and end by COPYING the exact times of the first and last kept word from the WORD TIMINGS list. To drop words (an um, a false start, a stumble, a repeated take), do not omit them silently: end the segment before them and start the next segment after them, so the gap between segments carries the removal, and add a matching cut. If the creator's direction asks to keep their own voice, prefer \"original\" wherever the words are spoken cleanly." + NL
  sys += "2. cuts: the footage spans to DROP within this scene, each {start, end} in seconds (dead air, tangents, coughs, repeated takes, anything the tightened narration no longer needs)." + NL + NL
  sys += "BIAS TOWARD INCLUDING MORE, NOT LESS: the creator can trim further by hand afterwards but CANNOT recover audio you remove, so when in doubt, KEEP it. Never clip a kept word - set a segment's start at or a little BEFORE its first kept word's start time, and its end at or a little AFTER its last kept word's end time (pad each edge outward by about 0.2s into the adjacent silence, staying within the scene span and not overlapping the next segment), so word onsets and tails are never cut off. Make cuts only around CLEARLY unwanted material (coughs, obvious false starts, repeated takes, long dead air); keep each cut's edges just INSIDE the unwanted span so a cut never touches a word you are keeping. Prefer slightly longer segments and far fewer, larger cuts. DO NOT CUT TOO CLOSE TOGETHER: ending one kept run and starting another only a few seconds later makes the video choppy and is risky. If removing a span would leave only a short run of footage (less than about 3 seconds) between it and an adjacent cut or a segment boundary, do NOT make that cut - keep the footage and accept the small patch of dead space instead. A little imperfect dead air is better than an over-cut, choppy take. Aim to cut out a few LARGER unwanted spans (whole tangents, long dead air, abandoned takes) rather than many tiny micro-slices; skip cuts shorter than about a second unless the span is clearly unwanted (a cough or a hard interruption)." + NL + NL
  sys += "Rules: all values are SECONDS from the start of the whole recording and MUST lie within the scene span [" + start + ", " + end + "]. For every segment and cut start < end. Segments are ordered earliest-first and must NOT overlap. Use the word timings and frame timestamps to be accurate." + NL + NL
  sys += "CONTINUITY: this scene is one of several stitched together in order. You may be told its position in the talk and where the PREVIOUS scene's narration ended. When given, make this scene's OPENING narration follow on naturally from that lead-in - pick up the thread and match the cadence, and do NOT re-introduce or repeat what was just said. The previous-scene text is context only: never include, repeat or re-voice it as part of this scene." + NL + NL
  sys += "Output STRICT JSON only - no markdown fences, no commentary - exactly this shape:" + NL
  sys += '{"segments": [{"text": string, "start": number, "end": number, "source": "original"|"revoice"}], "cuts": [{"start": number, "end": number}]}' + NL
  sys += "Return nothing but the JSON object."

  var prompt = ''
  prompt += "SCENE SPAN: start=" + start + "s, end=" + end + "s (duration " + Math.round(end - start) + "s)." + NL + NL
  prompt += "SCENE WORD TIMINGS (one line per spoken word, \"start end word\" in seconds on the shared timeline; copy these exact numbers for your segment and cut boundaries):" + NL + NL + wordTimings + NL + NL
  prompt += "The attached images are dense contact sheets for THIS scene." + NL + NL
  if (directorDirection) {
    prompt += "THE CREATOR'S OVERALL DIRECTION FOR THE WHOLE VIDEO (context for this scene): " + directorDirection + NL + NL
  }
  if (direction) {
    prompt += "THE CREATOR'S INSTRUCTIONS FOR THIS SCENE (follow these): " + direction + NL + NL
  }
  if (sceneNumber && sceneCount) {
    prompt += "POSITION IN THE TALK: this is scene " + sceneNumber + " of " + sceneCount + "." + NL + NL
  }
  if (previousContext) {
    prompt += "THE PREVIOUS SCENE'S NARRATION ENDED WITH (lead-in context only - NOT part of this scene; do not repeat, include or re-voice it): \"" + previousContext + "\"" + NL + NL
    prompt += "Open this scene's narration so it flows naturally on from that lead-in." + NL + NL
  }
  prompt += "Now build the tightened cut FROM SCRATCH from the exact word timings above, and produce the segments and cuts as STRICT JSON exactly as specified. Return nothing but the JSON object."

  out.start = start
  out.end = end
  out.system = sys
  out.prompt = prompt
  return out
}
```

- [ ] **Step 3: New `refiner` step (replaces the replicate step; same id/name so downstream expressions keep working)**

```json
{
  "id": "refiner",
  "name": "refiner",
  "handlerType": "ai_handler",
  "config": {
    "mode": "completion",
    "responseMode": "message",
    "provider": "anthropic",
    "model": "claude-sonnet-4-6",
    "systemPrompt": "{{steps.prep.system}}",
    "messageField": "steps.prep.prompt",
    "attachments": [{ "type": "image", "source": "steps.collect.images" }],
    "maxTokens": 32000,
    "temperature": 0.5,
    "skills": { "mode": "none" },
    "timeout": 280000
  }
}
```

Notes: `systemPrompt` uses `{{...}}` template syntax (the handler's `$`-prefix expression path is dead code); `skills: {mode:'none'}` is explicit because the handler treats missing skills config as enabled.

- [ ] **Step 4: `parse` step edit (only the extraction head changes)**

In the original `parse` function code, replace this block:

```js
  var d = (steps && steps.refiner) || {}

  // Replicate/Gemini call failed (model overloaded, timeout, API error): the
  // executor drops a failed post-step's output, so steps.refiner is empty here.
  if (!d || (d.status == null && d.output == null)) {
    return { ok: false, notOk: true, error: 'The AI model did not return a result for this scene — it may be temporarily overloaded, or the scene may be too long. Please try refining again.', data: { segments: [], cuts: [] } }
  }

  var raw = d.output != null ? d.output : d
  var text = ''
  if (typeof raw === 'string') {
    text = raw
  } else if (raw && typeof raw.length === 'number') {
    for (var a = 0; a < raw.length; a++) {
      text += String(raw[a])
    }
  } else if (raw && typeof raw.text === 'string') {
    text = raw.text
  }
```

with:

```js
  var d = (steps && steps.refiner) || {}

  // ai_handler call failed (model overloaded, timeout, API error): the
  // executor drops a failed post-step's output, so steps.refiner is empty here.
  if (!d || typeof d.content !== 'string' || !d.content) {
    return { ok: false, notOk: true, error: 'The AI model did not return a result for this scene — it may be temporarily overloaded, or the scene may be too long. Please try refining again.', data: { segments: [], cuts: [] } }
  }

  var text = d.content
```

Everything after (salvage helpers, clamping, segments/cuts assembly, return) is unchanged from the original.

- [ ] **Step 5: Assemble and create the rule**

Call `mcp__bffless-j5s__create_proxy_rule` with:

- `ruleSetId`: `591dab6e-51cf-4d15-8b04-36b50f5d8c6d`
- `pathPattern`: `/api/refine-scene-claude`
- `method`: `POST`
- `targetUrl`: `pipeline`, `proxyType`: `pipeline`, `stripPrefix`: true, `timeout`: 30000
- `description`: "Claude variant of the per-scene refiner: ai_handler (anthropic claude-sonnet-4-6) with contact-sheet image attachments instead of Replicate/Gemini. NO AUDIO (Anthropic has no audio input) — cut/segment boundaries come from word timings + contact sheets only. Same enqueue+poll contract and studio_jobs schema as /api/refine-scene; audioUrl in the request is ignored. Created per docs/superpowers/specs/2026-07-02-ai-handler-attachments-refine-claude-design.md (ce repo)."
- `pipelineConfig`:
  - `name`: "Per-scene refiner — Claude (async enqueue + poll)"
  - `description`: same summary as the rule description
  - `steps`: `[prep (Step 2 code), createJob, respond]` — `createJob` and `respond` copied verbatim from the source rule (schema `46f5eef6-cabe-48cf-95f8-05c9b94de2a7`, `kind: 'refine'`)
  - `postSteps`: `[setRunning, sign0…sign9, collect, refiner (Step 3), parse (Step 4), finishOk, finishErr]` — all except `refiner`/`parse` copied verbatim from the source rule; **`signAudio` is omitted**
  - `validators`: `[]`

Then call `mcp__bffless-j5s__enable_pipeline_debug` for the new rule (the source rule has `debugEnabled: true`).

- [ ] **Step 6: Verify the rule set**

Call `mcp__bffless-j5s__get_proxy_rule_set` (id `591dab6e-51cf-4d15-8b04-36b50f5d8c6d`) and confirm: the new rule exists with the expected steps, and the original `/api/refine-scene` rule is untouched.

---

### Task 8: End-to-end test + re-export

**Interfaces:**
- Consumes: the live `/api/refine-scene-claude` endpoint from Task 7.

- [ ] **Step 1: Build a real test payload**

Query a recent successful refine job for its recorded request: `mcp__bffless-j5s__query_pipeline_data` with `schemaId: 46f5eef6-cabe-48cf-95f8-05c9b94de2a7`, filter `kind: { op: 'eq', value: 'refine' }`, `status: { op: 'eq', value: 'done' }`, pageSize 1. The `request` field holds the original body (`sheetUrls`, `wordTimings`, `start`, `end`, `audioUrl`, ...). Save it to the scratchpad.

- [ ] **Step 2: Fire the new endpoint**

(Single-line curl per repo rule; body via heredoc.)

```bash
curl -s -X POST https://<studio-alias-host>/api/refine-scene-claude -H "Content-Type: application/json" -d @/private/tmp/.../scratchpad/refine-payload.json
```

Expected: `{ "jobId": "<uuid>", "status": "pending" }` within ~1s.

- [ ] **Step 3: Poll the job row**

`mcp__bffless-j5s__get_pipeline_record` with the job schema + jobId every ~20s until `status` is `done` or `error` (expect < 4 min).

Expected: `status: 'done'`, `result.segments` non-empty with plausible `{text,start,end,source}` values inside the scene span, `result.cuts` sane. If `error`: pull the pipeline log (`mcp__bffless-j5s__list_pipeline_logs` for the new rule → `get_pipeline_log`) and inspect the `refiner` step output.

- [ ] **Step 4: Compare quality (spot check)**

Run the same payload through the original `/api/refine-scene` (or use the recorded `result` from Step 1's job row) and eyeball: comparable segment boundaries, no clipped words at boundaries per the word timings. Flag to the user if Claude's cuts look materially worse (spec risk: image downscaling of dense contact sheets).

- [ ] **Step 5: Re-export the Studio rule set JSON**

The committed export must be refreshed **from the dashboard, not hand-edited** (standing project rule): user re-exports the Studio proxy rule set from the admin UI, then replace `~/projects/sahp/bffless-apps/apps/studio/bffless/studio.proxy-rules.json` with the export and commit in `bffless-apps` (ask user first):

```bash
cd ~/projects/sahp/bffless-apps && git add apps/studio/bffless/studio.proxy-rules.json && git commit -m "chore: export studio proxy rules with refine-scene-claude pipeline"
```

---

## Self-Review Notes

- Spec coverage: config shape (T2), runtime fan-out/skip/URL-passthrough (T1+T3), validateConfig (T2), MCP docs (T4), editor UI incl. round-trip (T5), tests incl. zero-attachment regression (T1–T3), pipeline deltas prep/signAudio/refiner/parse (T7), rollout order (T6→T7), manual test + re-export (T8). Risks are observational (T8 Step 4).
- Type consistency: `AIAttachmentConfig` defined once in `ai-attachments.util.ts`, imported by the backend interface; frontend mirrors the literal shape. `buildAttachmentParts(attachments, resolveSource)` signature used identically in T1 and T3.
- The `file`/`mediaType` path is schema+util-tested only (spec: out of scope beyond validation).
