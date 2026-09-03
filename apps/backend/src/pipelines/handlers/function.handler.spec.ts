import { FunctionHandler } from './function.handler';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { FunctionRunnerService } from '../function-runner.service';
import { PipelineContext } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';

function createHandler() {
  const registry = { register: jest.fn() };
  const runnerMock = {
    validateCode: jest.fn().mockReturnValue({ valid: true }),
    run: jest.fn(),
  };
  const handler = new FunctionHandler(
    registry as unknown as StepHandlerRegistry,
    runnerMock as unknown as FunctionRunnerService,
  );
  return { handler, runnerMock };
}

function makeContext(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    request: { body: {} } as never,
    stepOutputs: {},
    projectId: 'proj-1',
    pipelineId: 'pipe-1',
    metadata: { path: '/x', method: 'POST', headers: {}, query: {}, body: {} },
    ...overrides,
  } as PipelineContext;
}

function makeStep(config: Record<string, unknown>): PipelineStep {
  return {
    id: 'fn',
    name: 'fn',
    handlerType: 'function_handler',
    config,
  } as PipelineStep;
}

describe('FunctionHandler.execute — user.groups', () => {
  it('exposes user.groups to the sandboxed function', async () => {
    const { handler, runnerMock } = createHandler();
    runnerMock.run.mockResolvedValue({ success: true, output: {}, executionTime: 1, logs: [] });
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
    const { handler, runnerMock } = createHandler();
    runnerMock.run.mockResolvedValue({ success: true, output: {}, executionTime: 1, logs: [] });
    const context = makeContext({ user: { id: 'u1', role: 'user' } });

    await handler.execute(context, makeStep({ code: 'export default () => ({})' }));

    expect(runnerMock.run).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ user: expect.objectContaining({ groups: [] }) }),
      expect.anything(),
    );
  });

  it('leaves user undefined for anonymous requests', async () => {
    const { handler, runnerMock } = createHandler();
    runnerMock.run.mockResolvedValue({ success: true, output: {}, executionTime: 1, logs: [] });
    const context = makeContext();

    await handler.execute(context, makeStep({ code: 'export default () => ({})' }));

    expect(runnerMock.run).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ user: undefined }),
      expect.anything(),
    );
  });
});

describe('FunctionHandler.execute — user.credential / user.scopes (app tokens)', () => {
  it('exposes the credential kind and scopes of an app token', async () => {
    const { handler, runnerMock } = createHandler();
    runnerMock.run.mockResolvedValue({ success: true, output: {}, executionTime: 1, logs: [] });
    const context = makeContext({
      user: { id: 'u1', role: 'user', credential: 'app_token', scopes: ['workflow:read'] },
    });

    await handler.execute(context, makeStep({ code: 'export default () => ({})' }));

    expect(runnerMock.run).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        user: expect.objectContaining({ credential: 'app_token', scopes: ['workflow:read'] }),
      }),
      expect.anything(),
    );
  });

  it('adds nothing for a session user', async () => {
    const { handler, runnerMock } = createHandler();
    runnerMock.run.mockResolvedValue({ success: true, output: {}, executionTime: 1, logs: [] });
    const context = makeContext({ user: { id: 'u1', role: 'user' } });

    await handler.execute(context, makeStep({ code: 'export default () => ({})' }));

    const data = runnerMock.run.mock.calls[0][1] as { user: Record<string, unknown> };
    expect(data.user).not.toHaveProperty('credential');
    expect(data.user).not.toHaveProperty('scopes');
  });
});
