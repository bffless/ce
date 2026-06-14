import { ExpressionEvaluator } from './expression-evaluator';
import { PipelineContext } from './pipeline-context.interface';
import { ExpressionError } from '../errors';

describe('ExpressionEvaluator — secrets namespace', () => {
  const evaluator = new ExpressionEvaluator();

  const buildContext = (secrets?: Record<string, string>): PipelineContext =>
    ({
      request: {} as never,
      stepOutputs: {},
      projectId: 'p1',
      pipelineId: 'pl1',
      metadata: { path: '/', method: 'POST', headers: {}, query: {}, body: {} },
      secrets,
    }) as PipelineContext;

  it('resolves secrets.NAME to the decrypted value', () => {
    const ctx = buildContext({ HF_TOKEN: 'hf_abc123' });
    expect(evaluator.evaluateExpression('secrets.HF_TOKEN', ctx)).toBe('hf_abc123');
  });

  it('returns null for an unknown secret name', () => {
    const ctx = buildContext({ HF_TOKEN: 'hf_abc123' });
    expect(evaluator.evaluateExpression('secrets.MISSING', ctx)).toBeNull();
  });

  it('returns null when no secrets are loaded', () => {
    const ctx = buildContext(undefined);
    expect(evaluator.evaluateExpression('secrets.HF_TOKEN', ctx)).toBeNull();
  });

  it('throws when referencing the bare secrets root with no name', () => {
    const ctx = buildContext({ HF_TOKEN: 'hf_abc123' });
    expect(() => evaluator.evaluateExpression('secrets', ctx)).toThrow(ExpressionError);
  });

  it('interpolates a secret inside a template', () => {
    const ctx = buildContext({ HF_TOKEN: 'hf_abc123' });
    expect(evaluator.evaluateTemplate('Bearer {{secrets.HF_TOKEN}}', ctx)).toBe('Bearer hf_abc123');
  });
});
