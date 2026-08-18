import { Provider } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { RemoteConnectionsService } from './remote-connections.service';
import type { RemoteClient } from './remote-client';
import type { ResolvedConnection } from './remote-connections.types';

export const REMOTE_CONNECTIONS = Symbol('REMOTE_CONNECTIONS');

/** The narrow, LAZY view handlers/executors get (resolved through ModuleRef on first use). */
export interface RemoteConnectionsPort {
  resolve(name: string): ResolvedConnection | null;
  client(conn: ResolvedConnection): RemoteClient;
  acquire(conn: ResolvedConnection): () => void;
}

/**
 * Resolved LAZILY through ModuleRef, same pattern as FFMPEG_CONFIG_PROVIDERS
 * (`ffmpeg/executor/ffmpeg-config.providers.ts`): nothing here calls
 * RemoteConnectionsService during construction, so a consumer can depend on
 * this token without closing a module-evaluation cycle back through
 * RemoteConnectionsModule.
 */
export const REMOTE_CONNECTIONS_PROVIDER: Provider = {
  provide: REMOTE_CONNECTIONS,
  useFactory: (ref: ModuleRef): RemoteConnectionsPort => ({
    resolve: (n) => ref.get(RemoteConnectionsService, { strict: false }).resolve(n),
    client: (c) => ref.get(RemoteConnectionsService, { strict: false }).client(c),
    acquire: (c) => {
      const s = ref.get(RemoteConnectionsService, { strict: false });
      return s.fuse.acquire(c.name, c.maxInflight);
    },
  }),
  inject: [ModuleRef],
};
