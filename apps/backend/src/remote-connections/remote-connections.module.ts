import { Module } from '@nestjs/common';
import {
  RemoteConnectionNamesController,
  RemoteConnectionsController,
} from './remote-connections.controller';
import { RemoteConnectionsService } from './remote-connections.service';
import { REMOTE_CONNECTIONS, REMOTE_CONNECTIONS_PROVIDER } from './remote-connections.tokens';

/**
 * Instance-level remote connections (spec §2). Imports nothing from
 * pipelines/settings — the ffmpeg executor and the remote_request step depend
 * on this module (via REMOTE_CONNECTIONS), not the reverse, so it must not
 * import PipelinesModule/SettingsModule to avoid a cycle.
 */
@Module({
  providers: [RemoteConnectionsService, REMOTE_CONNECTIONS_PROVIDER],
  controllers: [RemoteConnectionsController, RemoteConnectionNamesController],
  exports: [RemoteConnectionsService, REMOTE_CONNECTIONS],
})
export class RemoteConnectionsModule {}
