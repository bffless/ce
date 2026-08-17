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
 * Admin Settings → Features → Server video ops → Executor. Admin-only; the
 * service-account key is write-only (never in a response). Lives in
 * PipelinesModule (not SettingsModule) because it depends on the executor
 * services and SettingsModule must not import PipelinesModule.
 */
@ApiTags('settings')
@Controller('api/settings/ffmpeg-executor')
@UseGuards(ApiKeyGuard, RolesGuard)
export class FfmpegExecutorSettingsController {
  constructor(private readonly settings: FfmpegExecutorSettingsService) {}

  @Get()
  @Roles('admin')
  @ApiOperation({
    summary: 'ffmpeg executor settings (Local / Remote) — the SA key is never returned',
  })
  @ApiResponse({ status: 200 })
  getStatus() {
    return this.settings.getStatus();
  }

  @Put()
  @Roles('admin')
  @ApiOperation({
    summary:
      'Update ffmpeg executor settings (partial; saKeyJson: string=replace, null=clear, absent=keep)',
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 400, description: 'Invalid combination (see message)' })
  update(@Body() body: UpdateFfmpegExecutorInput, @CurrentUser() user: { id: string }) {
    return this.settings.update(body, user?.id);
  }

  @Post('test')
  @Roles('admin')
  @ApiOperation({
    summary: 'Test the Worker connection for the saved settings or an unsaved draft',
  })
  @ApiResponse({ status: 200 })
  test(@Body() body: FfmpegExecutorTestDraft = {}) {
    return this.settings.testConnection(body ?? {});
  }
}
