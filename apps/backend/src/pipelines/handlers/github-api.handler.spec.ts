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
