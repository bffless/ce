import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { GlobalExceptionFilter } from './http-exception.filter';

/**
 * The filter rebuilds every error body. The contract under test: a handler's
 * structured details (`code`, `missingScopes`, `errors`, …) reach the client,
 * while the keys the filter owns cannot be overridden by the exception body.
 */
describe('GlobalExceptionFilter', () => {
  const run = (exception: unknown) => {
    const response = {
      headersSent: false,
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      setHeader: jest.fn(),
    };
    const request = { url: '/api/auth/session/from-app-token', method: 'POST', ip: '10.0.0.1' };
    const host = {
      switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }),
    } as unknown as ArgumentsHost;
    new GlobalExceptionFilter().catch(exception, host);
    expect(response.status).toHaveBeenCalledTimes(1);
    expect(response.json).toHaveBeenCalledTimes(1);
    return {
      status: response.status.mock.calls[0][0] as number,
      body: response.json.mock.calls[0][0],
    };
  };

  it('passes structured details on the exception body through to the client', () => {
    const { status, body } = run(
      new ForbiddenException({
        code: 'insufficient_scope',
        missingScopes: ['auth:session'],
        message: 'insufficient_scope: missing auth:session',
      }),
    );
    expect(status).toBe(403);
    expect(body).toMatchObject({
      statusCode: 403,
      error: 'Forbidden',
      message: 'insufficient_scope: missing auth:session',
      code: 'insufficient_scope',
      missingScopes: ['auth:session'],
      path: '/api/auth/session/from-app-token',
    });
  });

  it('never lets the exception body override the keys the filter owns', () => {
    const { status, body } = run(
      new BadRequestException({
        message: 'nope',
        statusCode: 999,
        path: '/elsewhere',
        timestamp: 'yesterday',
        stack: 'forged',
        error: 'custom_error',
        detail: 'kept',
      }),
    );
    expect(status).toBe(400);
    expect(body.statusCode).toBe(400);
    expect(body.path).toBe('/api/auth/session/from-app-token');
    expect(body.timestamp).not.toBe('yesterday');
    expect(body.stack).not.toBe('forged');
    // `error` is a documented override (email-verification.guard relies on it).
    expect(body.error).toBe('custom_error');
    expect(body.detail).toBe('kept');
  });

  it("leaves Nest's default bodies and string bodies exactly as before", () => {
    const fromDefault = run(new NotFoundException('nothing here'));
    expect(fromDefault.status).toBe(404);
    expect(fromDefault.body).toMatchObject({
      statusCode: 404,
      error: 'Not Found',
      message: 'nothing here',
    });
    const fromString = run(new BadRequestException('plain'));
    expect(fromString.body).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
      message: 'plain',
    });
    for (const { body } of [fromDefault, fromString]) {
      expect(Object.keys(body).sort()).toEqual(
        ['error', 'message', 'path', 'stack', 'statusCode', 'timestamp'].sort(),
      );
    }
  });
});
