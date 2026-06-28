import { Request } from 'express';
import { PipelineExecutionService } from './pipeline-execution.service';
import { StepHandlerRegistry } from './step-handler.registry';
import { ValidatorRegistry } from './validator.registry';
import { ExpressionEvaluator } from './expression-evaluator';
import { Pipeline, PipelineStep } from '../types';
import { StepResult } from './pipeline-context.interface';

describe('PipelineExecutionService — early termination', () => {
  const buildService = (
    mainHandler: { execute: jest.Mock },
    postHandler: { execute: jest.Mock },
  ) => {
    const handlerRegistry = {
      get: jest.fn((handlerType: string) => {
        if (handlerType === 'main') {
          return { execute: mainHandler.execute, validateConfig: jest.fn() };
        }
        return { execute: postHandler.execute, validateConfig: jest.fn() };
      }),
    } as unknown as StepHandlerRegistry;

    const validatorRegistry = {
      get: jest.fn(),
    } as unknown as ValidatorRegistry;

    const expressionEvaluator = {
      evaluateCondition: jest.fn().mockReturnValue(true),
      evaluateExpression: jest.fn(),
    } as unknown as ExpressionEvaluator;

    const projectSecretsService = {
      getDecryptedSecrets: jest.fn().mockResolvedValue({}),
    } as unknown as import('../../projects/project-secrets.service').ProjectSecretsService;

    return new PipelineExecutionService(
      handlerRegistry,
      validatorRegistry,
      expressionEvaluator,
      projectSecretsService,
    );
  };

  const buildRequest = (): Request =>
    ({
      path: '/test',
      method: 'POST',
      headers: {},
      query: {},
      body: {},
      get: () => undefined,
    }) as unknown as Request;

  const buildPipeline = (
    steps: PipelineStep[],
    postSteps: PipelineStep[],
  ): Pipeline & { steps: PipelineStep[] } =>
    ({
      id: 'test-pipeline',
      projectId: 'test-project',
      name: 'test',
      steps,
      postSteps,
      validators: [],
    }) as unknown as Pipeline & { steps: PipelineStep[] };

  it('does NOT run post-steps when a main step returns terminates:true', async () => {
    const mainExecute = jest.fn<Promise<StepResult>, unknown[]>().mockResolvedValue({
      success: true,
      output: { ignored: true, eventType: 'checkout.session.expired' },
      terminates: true,
    });
    const postExecute = jest.fn<Promise<StepResult>, unknown[]>().mockResolvedValue({
      success: true,
      output: { sent: true },
    });

    const service = buildService({ execute: mainExecute }, { execute: postExecute });

    const pipeline = buildPipeline(
      [
        {
          id: 'verify',
          name: 'verify',
          handlerType: 'main',
          isEnabled: true,
          config: {},
        } as PipelineStep,
      ],
      [
        {
          id: 'notify',
          name: 'notify',
          handlerType: 'post',
          isEnabled: true,
          config: {},
        } as PipelineStep,
      ],
    );

    const result = await service.executePipelineWithDebug(pipeline, buildRequest());

    expect(result.success).toBe(true);
    expect(mainExecute).toHaveBeenCalledTimes(1);
    expect(postExecute).not.toHaveBeenCalled();
    expect(result.postStepsPromise).toBeUndefined();
  });

  it('DOES run post-steps when the pipeline completes normally', async () => {
    const mainExecute = jest.fn<Promise<StepResult>, unknown[]>().mockResolvedValue({
      success: true,
      output: { ok: true },
    });
    const postExecute = jest.fn<Promise<StepResult>, unknown[]>().mockResolvedValue({
      success: true,
      output: { sent: true },
    });

    const service = buildService({ execute: mainExecute }, { execute: postExecute });

    const pipeline = buildPipeline(
      [
        {
          id: 'work',
          name: 'work',
          handlerType: 'main',
          isEnabled: true,
          config: {},
        } as PipelineStep,
      ],
      [
        {
          id: 'notify',
          name: 'notify',
          handlerType: 'post',
          isEnabled: true,
          config: {},
        } as PipelineStep,
      ],
    );

    const result = await service.executePipelineWithDebug(pipeline, buildRequest());
    await result.postStepsPromise;

    expect(result.success).toBe(true);
    expect(mainExecute).toHaveBeenCalledTimes(1);
    expect(postExecute).toHaveBeenCalledTimes(1);
  });

  describe('debug capture gating (memory)', () => {
    it('omits heavy per-step input/output snapshots when captureDebug is false', async () => {
      const big = 'x'.repeat(1000);
      const mainExecute = jest
        .fn<Promise<StepResult>, unknown[]>()
        .mockResolvedValue({ success: true, output: { big } });

      const service = buildService({ execute: mainExecute }, { execute: jest.fn() });
      const pipeline = buildPipeline(
        [{ id: 'work', name: 'work', handlerType: 'main', isEnabled: true, config: {} } as PipelineStep],
        [],
      );

      const result = await service.executePipelineWithDebug(pipeline, buildRequest(), undefined, {
        captureDebug: false,
      });

      // Execution still works and runtime step outputs are intact (needed for chaining/response).
      expect(result.success).toBe(true);
      expect(result.stepOutputs?.work).toEqual({ big });

      // But the heavy debug snapshots are NOT retained.
      expect(result.debug?.steps).toHaveLength(1);
      expect(result.debug?.steps[0].status).toBe('success');
      expect(result.debug?.steps[0].input).toBeUndefined();
      expect(result.debug?.steps[0].output).toBeUndefined();
    });

    it('retains per-step input/output snapshots when captureDebug defaults on', async () => {
      const mainExecute = jest
        .fn<Promise<StepResult>, unknown[]>()
        .mockResolvedValue({ success: true, output: { ok: true } });

      const service = buildService({ execute: mainExecute }, { execute: jest.fn() });
      const pipeline = buildPipeline(
        [{ id: 'work', name: 'work', handlerType: 'main', isEnabled: true, config: {} } as PipelineStep],
        [],
      );

      const result = await service.executePipelineWithDebug(pipeline, buildRequest());

      expect(result.debug?.steps[0].input).toBeDefined();
      expect(result.debug?.steps[0].output).toEqual({ ok: true });
    });
  });
});
