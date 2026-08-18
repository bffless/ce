import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser, type CurrentUserData } from '../auth/decorators/current-user.decorator';
import {
  RemoteConnectionsService,
  type RemoteConnectionTestDraft,
  type UpsertRemoteConnectionInput,
} from './remote-connections.service';

/**
 * Admin Settings → Remote connections (spec §3.1). Admin-only; the credential
 * is write-only (never in a response). Lives alongside the service, imported
 * by both AppModule (top-level `/api/settings/...`) and PipelinesModule (the
 * ffmpeg executor and remote_request step resolve connections through
 * REMOTE_CONNECTIONS, not this controller).
 */
@ApiTags('settings')
@Controller('api/settings/remote-connections')
@UseGuards(ApiKeyGuard, RolesGuard)
export class RemoteConnectionsController {
  constructor(private readonly connections: RemoteConnectionsService) {}

  @Get()
  @Roles('admin')
  @ApiOperation({ summary: 'List remote connections — the credential is never returned' })
  @ApiResponse({ status: 200 })
  list() {
    return this.connections.status();
  }

  @Post()
  @Roles('admin')
  @ApiOperation({ summary: 'Create a remote connection' })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 400, description: 'Invalid input (see message)' })
  create(@Body() body: UpsertRemoteConnectionInput, @CurrentUser() user: CurrentUserData) {
    return this.connections.create(body, user?.id);
  }

  @Put(':id')
  @Roles('admin')
  @ApiOperation({
    summary:
      'Update a remote connection (partial; credential: string=replace, null=clear, absent=keep)',
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 400, description: 'Invalid input (see message)' })
  @ApiResponse({ status: 404, description: 'Not found' })
  update(
    @Param('id') id: string,
    @Body() body: UpsertRemoteConnectionInput,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.connections.update(id, body, user?.id);
  }

  @Delete(':id')
  @Roles('admin')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a remote connection' })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 409, description: 'In use by the ffmpeg Remote executor' })
  remove(@Param('id') id: string) {
    return this.connections.remove(id);
  }

  @Post('test')
  @Roles('admin')
  @ApiOperation({ summary: 'Test a remote connection for the saved settings or an unsaved draft' })
  @ApiResponse({ status: 200 })
  test(@Body() body: RemoteConnectionTestDraft = {}) {
    return this.connections.test(body ?? {});
  }
}

/**
 * Any authenticated user (project owners editing rules need to name a
 * connection in `remote_request` steps) — no @Roles, ApiKeyGuard only.
 * Strips everything but {name, auth}: no url, id, or credential.
 */
@ApiTags('remote-connections')
@Controller('api/remote-connections')
@UseGuards(ApiKeyGuard)
export class RemoteConnectionNamesController {
  constructor(private readonly connections: RemoteConnectionsService) {}

  @Get()
  @ApiOperation({ summary: 'List remote connection names for rule authoring (name + auth only)' })
  @ApiResponse({ status: 200 })
  names() {
    return this.connections.list().map((conn) => ({ name: conn.name, auth: conn.auth }));
  }
}
