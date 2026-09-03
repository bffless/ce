import {
  ERR,
  PROTOCOL_VERSIONS,
  errorResponse,
  negotiateVersion,
  okResponse,
  parseMessage,
} from './jsonrpc';

describe('jsonrpc', () => {
  it('parses a request, defaulting params', () => {
    expect(parseMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).toEqual({
      kind: 'request',
      id: 1,
      method: 'tools/list',
      params: {},
    });
  });
  it('treats a message without an id as a notification', () => {
    expect(parseMessage({ jsonrpc: '2.0', method: 'notifications/initialized' })).toEqual({
      kind: 'notification',
      method: 'notifications/initialized',
      params: {},
    });
  });
  it('refuses batches, non-objects, wrong versions and missing methods, keeping the id when present', () => {
    expect(parseMessage([]).kind).toBe('invalid');
    expect(parseMessage('x').kind).toBe('invalid');
    expect(parseMessage({ jsonrpc: '1.0', id: 3, method: 'x' })).toMatchObject({
      kind: 'invalid',
      id: 3,
    });
    expect(parseMessage({ jsonrpc: '2.0', id: 'a' })).toMatchObject({ kind: 'invalid', id: 'a' });
  });
  it('negotiates the version', () => {
    expect(negotiateVersion('2025-03-26', PROTOCOL_VERSIONS)).toBe('2025-03-26');
    expect(negotiateVersion('1999-01-01', PROTOCOL_VERSIONS)).toBe('2025-06-18');
    expect(negotiateVersion(undefined, PROTOCOL_VERSIONS)).toBe('2025-06-18');
  });
  it('builds envelopes', () => {
    expect(okResponse(1, { a: 1 })).toEqual({ jsonrpc: '2.0', id: 1, result: { a: 1 } });
    expect(errorResponse(null, ERR.METHOD_NOT_FOUND, 'nope')).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32601, message: 'nope' },
    });
    expect(errorResponse(2, ERR.INTERNAL, 'x', { y: 1 }).error).toEqual({
      code: -32603,
      message: 'x',
      data: { y: 1 },
    });
  });
});
