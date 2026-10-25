import { statusForPipelineError } from './pipeline-from-rule';

describe('statusForPipelineError', () => {
  it('keeps the engine code table', () => {
    expect(statusForPipelineError('VALIDATION_ERROR')).toBe(400);
    expect(statusForPipelineError('AUTH_REQUIRED')).toBe(401);
    expect(statusForPipelineError('AUTHORIZATION_ERROR')).toBe(403);
    expect(statusForPipelineError('RATE_LIMIT_EXCEEDED')).toBe(429);
  });

  it('defaults to 500', () => {
    expect(statusForPipelineError(undefined)).toBe(500);
    expect(statusForPipelineError('EXECUTION_ERROR')).toBe(500);
    expect(statusForPipelineError('EXECUTION_ERROR', 'boom')).toBe(500);
    expect(statusForPipelineError('EXECUTION_ERROR', 'Something BAD_REQUEST: later')).toBe(500);
    expect(statusForPipelineError('EXECUTION_ERROR', 'TEAPOT: nope')).toBe(500);
    expect(statusForPipelineError('EXECUTION_ERROR', 'toString: x')).toBe(500);
  });

  it.each([
    ['BAD_REQUEST', 400],
    ['UNAUTHORIZED', 401],
    ['FORBIDDEN', 403],
    ['NOT_FOUND', 404],
    ['CONFLICT', 409],
    ['TOO_MANY_REQUESTS', 429],
  ])('maps a %s: message prefix to %i', (word, status) => {
    expect(statusForPipelineError('EXECUTION_ERROR', `${word}: missing kind`)).toBe(status);
  });

  it('maps an error code equal to a status word', () => {
    expect(statusForPipelineError('NOT_FOUND', 'no such record')).toBe(404);
    expect(statusForPipelineError('CONFLICT')).toBe(409);
  });

  it('engine codes win over a message prefix', () => {
    expect(statusForPipelineError('VALIDATION_ERROR', 'NOT_FOUND: x')).toBe(400);
  });
});
