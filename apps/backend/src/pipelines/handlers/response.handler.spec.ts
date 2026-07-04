import { ResponseHandler } from './response.handler';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { PipelineContext } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';

describe('ResponseHandler', () => {
  const buildHandler = () => {
    const registry = { register: jest.fn() } as unknown as StepHandlerRegistry;
    return new ResponseHandler(registry, new ExpressionEvaluator());
  };

  const step = (config: Record<string, unknown>): PipelineStep =>
    ({
      id: 'respond',
      name: 'respond',
      handlerType: 'response_handler',
      config,
    } as unknown as PipelineStep);

  const contextWithStep = (name: string, output: unknown): PipelineContext =>
    ({
      stepOutputs: { [name]: output },
      request: {},
    } as unknown as PipelineContext);

  const responseOf = async (handler: ResponseHandler, config: Record<string, unknown>, ctx: PipelineContext) => {
    const result = await handler.execute(ctx, step(config));
    expect(result.success).toBe(true);
    return { result, output: result.output as Record<string, unknown> };
  };

  describe('JSON string bodies (formatBody)', () => {
    it('passes a large strict-JSON rendered template through as a string without re-materializing it (#418)', async () => {
      const handler = buildHandler();
      // Above the 256 KiB pass-through threshold.
      const items = [
        { id: 1, content: 'a'.repeat(300 * 1024) },
        { id: 2, content: 'b' },
      ];
      const ctx = contextWithStep('query', items);

      const { output } = await responseOf(handler, { body: '{"items":{{{steps.query}}}}' }, ctx);

      // Body must remain the rendered string (sent verbatim by res.send),
      // not a parsed object that Express would JSON.stringify a second time.
      expect(typeof output.body).toBe('string');
      expect(JSON.parse(output.body as string)).toEqual({ items });
    });

    it('keeps parsing small strict-JSON bodies into objects so steps.<respond>.body.<field> access still works', async () => {
      const handler = buildHandler();
      const items = [{ id: 1 }, { id: 2 }];
      const ctx = contextWithStep('query', items);

      const { output } = await responseOf(handler, { body: '{"items":{{{steps.query}}}}' }, ctx);

      // Below the threshold, legacy behavior is preserved byte-for-byte:
      // post-steps referencing the response body as an object keep working.
      expect(output.body).toEqual({ items });
    });

    it('still JSON5-normalizes large non-strict bodies rather than passing them through', async () => {
      const handler = buildHandler();
      const big = 'a'.repeat(300 * 1024);
      const ctx = contextWithStep('query', { content: big });

      const { output } = await responseOf(
        handler,
        { body: '{ success: true, data: {{{steps.query}}}, }' },
        ctx,
      );

      expect(output.body).toEqual({ success: true, data: { content: big } });
    });

    it('normalizes JSON5-style template output (unquoted keys) into an object', async () => {
      const handler = buildHandler();
      const ctx = contextWithStep('query', { value: 42 });

      const { result, output } = await responseOf(
        handler,
        { body: '{ success: true, data: {{{steps.query}}} }' },
        ctx,
      );

      expect(output.body).toEqual({ success: true, data: { value: 42 } });
      expect(result.warning).toBeUndefined();
    });

    it('wraps invalid JSON in { message } with a warning', async () => {
      const handler = buildHandler();
      const ctx = contextWithStep('who', 'John Doe');

      const { result, output } = await responseOf(handler, { body: '{ name: {{steps.who}} }' }, ctx);

      expect(output.body).toEqual({ message: '{ name: John Doe }' });
      expect(result.warning).toContain('invalid JSON');
    });

    it('keeps parsing small scalar-rendering templates (legacy behavior below the threshold)', async () => {
      const handler = buildHandler();
      const ctx = contextWithStep('count', 123);

      const { output } = await responseOf(handler, { body: '{{{steps.count}}}' }, ctx);

      expect(output.body).toBe(123);
    });
  });

  describe('non-string and non-JSON bodies', () => {
    it('evaluates object bodies per-key and returns the object', async () => {
      const handler = buildHandler();
      const ctx = contextWithStep('user', { id: 'u1' });

      const { output } = await responseOf(handler, { body: { user: 'steps.user', ok: 'true' } }, ctx);

      expect(output.body).toEqual({ user: { id: 'u1' }, ok: true });
    });

    it('returns text bodies verbatim for text content types', async () => {
      const handler = buildHandler();
      const ctx = contextWithStep('unused', null);

      const { output } = await responseOf(
        handler,
        { body: 'hello world', contentType: 'text/plain' },
        ctx,
      );

      expect(output.body).toBe('hello world');
    });
  });

  describe('response envelope', () => {
    it('sets status, content type, and evaluated headers', async () => {
      const handler = buildHandler();
      const ctx = contextWithStep('id', 'abc');

      const { output } = await responseOf(
        handler,
        {
          body: '{"ok":true}',
          status: 201,
          headers: { 'X-Request-Id': '{{steps.id}}' },
        },
        ctx,
      );

      expect(output.__isResponse).toBe(true);
      expect(output.status).toBe(201);
      expect(output.headers).toEqual({
        'Content-Type': 'application/json',
        'X-Request-Id': 'abc',
      });
    });
  });
});
