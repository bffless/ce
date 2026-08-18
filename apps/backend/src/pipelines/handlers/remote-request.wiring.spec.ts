/**
 * The DI fence for remote_request: the handler takes the REMOTE_CONNECTIONS
 * token, which is resolved LAZILY through ModuleRef precisely so a pipeline
 * handler can depend on remote connections without closing a module-evaluation
 * cycle (same reason as ffmpeg-executor-wiring.spec.ts). If someone swaps the
 * token for a direct RemoteConnectionsService injection, this spec is what
 * notices.
 */
jest.mock('../../db/client', () => ({
  db: { select: jest.fn(), insert: jest.fn(), update: jest.fn() },
}));

import { Test } from '@nestjs/testing';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { RemoteConnectionsService } from '../../remote-connections/remote-connections.service';
import {
  REMOTE_CONNECTIONS,
  REMOTE_CONNECTIONS_PROVIDER,
} from '../../remote-connections/remote-connections.tokens';
import { RemoteRequestHandler } from './remote-request.handler';

it('resolves RemoteRequestHandler through the lazy connections token', async () => {
  const moduleRef = await Test.createTestingModule({
    providers: [
      StepHandlerRegistry,
      ExpressionEvaluator,
      RemoteConnectionsService,
      REMOTE_CONNECTIONS_PROVIDER,
      RemoteRequestHandler,
    ],
  }).compile();

  const handler = moduleRef.get(RemoteRequestHandler);
  expect(handler.type).toBe('remote_request');
  // It self-registered into the real registry the executor looks steps up in.
  expect(moduleRef.get(StepHandlerRegistry).get('remote_request')).toBe(handler);
  // The port it holds is the lazy token, not the service itself.
  const port = moduleRef.get(REMOTE_CONNECTIONS);
  expect((handler as unknown as { connections: unknown }).connections).toBe(port);
  expect(port).not.toBe(moduleRef.get(RemoteConnectionsService));
}, 10_000);
