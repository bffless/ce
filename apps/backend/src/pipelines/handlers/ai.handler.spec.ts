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
