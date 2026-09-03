import { invokeFailureResult, toolResultFromAnswer } from './results';

const answer = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
  status,
  body,
  headers,
  contentType: 'application/json',
});

describe('toolResultFromAnswer (Decision 15)', () => {
  it('passes a body that already is a CallToolResult through verbatim', () => {
    const body = {
      content: [{ type: 'text', text: 'Run x is running' }],
      structuredContent: { runId: 'x' },
    };
    expect(toolResultFromAnswer(answer(200, body), 't')).toBe(body);
  });
  it('wraps a plain object, a string and a scalar', () => {
    expect(toolResultFromAnswer(answer(200, { a: 1 }), 't')).toEqual({
      content: [{ type: 'text', text: '{"a":1}' }],
      structuredContent: { a: 1 },
    });
    expect(toolResultFromAnswer(answer(200, 'HI'), 't')).toEqual({
      content: [{ type: 'text', text: 'HI' }],
      structuredContent: { text: 'HI' },
    });
    expect(toolResultFromAnswer(answer(200, 3), 't').structuredContent).toEqual({ value: 3 });
  });
  it('names a 401 as errors.auth', () => {
    const r = toolResultFromAnswer(
      answer(401, {
        success: false,
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      }),
      'workflow.status',
    );
    expect(r.isError).toBe(true);
    expect(r.structuredContent?.errors).toEqual({
      auth: 'workflow.status needs a signed-in caller: Authentication required',
    });
    expect(r._meta).toEqual({ bffless: { status: 401 } });
  });
  it('names the missing scope from the WWW-Authenticate header, or from the error details', () => {
    const viaHeader = toolResultFromAnswer(
      answer(
        403,
        {
          success: false,
          error: {
            code: 'AUTHORIZATION_ERROR',
            message: 'insufficient_scope: missing workflow:run',
          },
        },
        {
          'WWW-Authenticate':
            'Bearer error="insufficient_scope", scope="workflow:run workflow:files"',
        },
      ),
      'workflow.submit',
    );
    expect(viaHeader.content[0].text).toBe(
      'insufficient_scope: missing workflow:run, workflow:files',
    );
    expect(viaHeader.structuredContent?.errors).toEqual({
      scope: 'missing workflow:run, workflow:files',
    });
    const viaDetails = toolResultFromAnswer(
      answer(403, {
        success: false,
        error: {
          code: 'AUTHORIZATION_ERROR',
          message: 'x',
          details: { code: 'insufficient_scope', missingScopes: ['workflow:run'] },
        },
      }),
      'workflow.submit',
    );
    expect(viaDetails.structuredContent?.errors).toEqual({ scope: 'missing workflow:run' });
  });
  it('flattens any other failure to code: message with the status in _meta', () => {
    const r = toolResultFromAnswer(
      answer(500, { success: false, error: { code: 'STEP_FAILED', message: 'boom' } }),
      't',
    );
    expect(r.content[0].text).toBe('STEP_FAILED: boom');
    expect(r.structuredContent?.errors).toEqual({ pipeline: 'STEP_FAILED: boom' });
    expect(r._meta).toEqual({ bffless: { status: 500 } });
    const text = toolResultFromAnswer(answer(502, 'Bad Gateway'), 't');
    expect(text.content[0].text).toBe('HTTP_502: Bad Gateway');
    const forbidden = toolResultFromAnswer(answer(403, { message: 'Access denied' }), 't');
    expect(forbidden.structuredContent?.errors).toEqual({ pipeline: 'HTTP_403: Access denied' });
  });
});

describe('invokeFailureResult', () => {
  it('words each failure kind', () => {
    expect(
      invokeFailureResult({ kind: 'no_rule' }, 'workflow.list', '/api/x').structuredContent?.errors,
    ).toEqual({ tool: 'no rule answers /api/x' });
    expect(invokeFailureResult({ kind: 'recursion' }, 't', '/p').structuredContent?.errors).toEqual(
      { tool: 'MCP_RECURSION' },
    );
    expect(
      invokeFailureResult({ kind: 'unsupported', proxyType: 'internal_rewrite' }, 't', '/p')
        .content[0].text,
    ).toContain('internal_rewrite');
    expect(
      invokeFailureResult({ kind: 'error', message: 'ECONNREFUSED' }, 't', '/p').structuredContent
        ?.errors,
    ).toEqual({ tool: 'ECONNREFUSED' });
  });
});
