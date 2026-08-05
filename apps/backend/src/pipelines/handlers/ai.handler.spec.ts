import { AIHandler } from './ai.handler';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { AIHandlerConfig } from '../execution/step-handler.interface';
import { generateText } from 'ai';
import { PipelineContext } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';

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
  const skillsService = {
    listSkills: jest.fn().mockResolvedValue([]),
    ...((overrides.skillsService as object) || {}),
  };
  const handler = new AIHandler(
    registry as never,
    new ExpressionEvaluator(),
    projectAISettingsService as never,
    {} as never, // PipelineDataService
    {} as never, // PipelineSchemasService
    skillsService as never, // SkillsService
    {} as never, // AIToolPluginService
  );
  return { handler, projectAISettingsService, skillsService };
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

  it('echoes resolvedMessages with URL parts flattened to plain strings (redactable)', async () => {
    const { handler } = createHandler();
    const context = createContext({
      prep: { prompt: 'refine this' },
      collect: { images: ['https://x.test/a.png?token=secret123'] },
    });

    const result = await handler.execute(
      context,
      completionStep({
        messageField: 'steps.prep.prompt',
        attachments: [{ type: 'image', source: 'steps.collect.images' }],
      }),
    );

    const resolved = (result.output as any).resolvedMessages;
    const userMessage = resolved.find((m: { role: string }) => m.role === 'user');
    expect(userMessage.content[1]).toEqual({
      type: 'image',
      image: 'https://x.test/a.png?token=secret123',
    });
    expect(typeof userMessage.content[1].image).toBe('string');
  });
});

describe('AIHandler.execute — step-scoped skills source', () => {
  beforeEach(() => {
    (generateText as jest.Mock).mockReset().mockResolvedValue({
      text: 'ok',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      finishReason: 'stop',
      steps: [],
    });
  });

  function deploymentContext(): PipelineContext {
    return {
      ...createContext({ prep: { prompt: 'draft a thumbnail' } }),
      deployment: { owner: 'bffless', repo: 'studio', commitSha: 'sha-serving' },
    } as PipelineContext;
  }

  it("loads skills from the step's own path instead of the project setting", async () => {
    const { handler, skillsService } = createHandler();

    await handler.execute(
      deploymentContext(),
      completionStep({
        messageField: 'steps.prep.prompt',
        skills: {
          mode: 'selected',
          enabled: ['image-prompts'],
          path: 'apps/studio/dist/bffless/skills',
        },
      }),
    );

    expect(skillsService.listSkills).toHaveBeenCalledWith(
      'bffless',
      'studio',
      'sha-serving',
      'apps/studio/dist/bffless/skills',
    );
  });

  it('falls back to the project skills path when the step declares none', async () => {
    const { handler, skillsService } = createHandler();

    await handler.execute(
      deploymentContext(),
      completionStep({
        messageField: 'steps.prep.prompt',
        skills: { mode: 'selected', enabled: ['image-prompts'] },
      }),
    );

    expect(skillsService.listSkills).toHaveBeenCalledWith(
      'bffless',
      'studio',
      'sha-serving',
      'skills',
    );
  });

  it("resolves the commit SHA from the step's own skills alias", async () => {
    const { handler, projectAISettingsService, skillsService } = createHandler();
    projectAISettingsService.resolveSkillsCommitSha.mockResolvedValue('sha-from-alias');

    await handler.execute(
      deploymentContext(),
      completionStep({
        messageField: 'steps.prep.prompt',
        skills: { mode: 'selected', enabled: ['image-prompts'], alias: 'skills-only' },
      }),
    );

    expect(projectAISettingsService.resolveSkillsCommitSha).toHaveBeenCalledWith(
      'proj-1',
      'sha-serving',
      'skills-only',
    );
    expect(skillsService.listSkills).toHaveBeenCalledWith(
      'bffless',
      'studio',
      'sha-from-alias',
      'skills',
    );
  });
});
