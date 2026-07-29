import { ExpressionEvaluator } from './expression-evaluator';
import { PipelineContext } from './pipeline-context.interface';

const context = {} as PipelineContext;

describe('ExpressionEvaluator built-in time functions', () => {
  const evaluator = new ExpressionEvaluator();

  it('now() keeps returning an ISO-8601 string (backward compatible)', () => {
    const value = evaluator.evaluateExpression('now()', context);
    expect(typeof value).toBe('string');
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('now_ms() returns epoch milliseconds as a number', () => {
    const before = Date.now();
    const value = evaluator.evaluateExpression('now_ms()', context);
    expect(typeof value).toBe('number');
    expect(value as number).toBeGreaterThanOrEqual(before);
    expect(value as number).toBeLessThanOrEqual(Date.now());
  });
});
