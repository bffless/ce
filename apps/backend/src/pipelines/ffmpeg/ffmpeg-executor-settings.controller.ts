import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../../auth/api-key.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import {
  FfmpegExecutorSettingsService,
  type FfmpegExecutorTestDraft,
  type UpdateFfmpegExecutorInput,
} from './ffmpeg-executor-settings.service';

/**
 * Admin Settings → Features → Server video ops → Executor. Admin-only. The
 * Remote executor's URL/auth/credential live in a remote connection (Plan 4) —
 * this endpoint only selects one BY NAME and never returns its credential.
 * Lives in PipelinesModule (not SettingsModule) because it depends on the
 * executor services and SettingsModule must not import PipelinesModule.
 */
@ApiTags('settings')
@Controller('api/settings/ffmpeg-executor')
@UseGuards(ApiKeyGuard, RolesGuard)
export class FfmpegExecutorSettingsController {
  constructor(private readonly settings: FfmpegExecutorSettingsService) {}

  @Get()
  @Roles('admin')
  @ApiOperation({
    summary:
      'ffmpeg executor settings (Local / Remote) + the selectable remote connections — the credential is never returned',
  })
  @ApiResponse({ status: 200 })
  getStatus() {
    return this.settings.getStatus();
  }

  @Put()
  @Roles('admin')
  @ApiOperation({
    summary:
      'Update ffmpeg executor settings (partial; remoteConnection: a connection NAME, null=clear, absent=keep)',
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 400, description: 'Invalid combination (see message)' })
  update(@Body() body: UpdateFfmpegExecutorInput, @CurrentUser() user: { id: string }) {
    return this.settings.update(body, user?.id);
  }

  @Post('test')
  @Roles('admin')
  @ApiOperation({
    summary:
      'Test the Worker connection for the saved settings or an unsaved draft ({ remoteConnection })',
  })
  @ApiResponse({ status: 200 })
  test(@Body() body: FfmpegExecutorTestDraft = {}) {
    return this.settings.testConnection(body ?? {});
  }
}
