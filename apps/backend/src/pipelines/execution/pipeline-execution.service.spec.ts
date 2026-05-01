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

    return new PipelineExecutionService(
      handlerRegistry,
      validatorRegistry,
      expressionEvaluator,
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
});
