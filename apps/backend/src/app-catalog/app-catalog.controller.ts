import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser, type CurrentUserData } from '../auth/decorators/current-user.decorator';
import { FeatureFlagGuard, RequireFeatureFlags } from '../feature-flags/feature-flag.guard';
import { AppCatalogService } from './app-catalog.service';
import {
  AckManualStepDto,
  PreflightRequestDto,
  UninstallQueryDto,
  UpdateInstalledAppDto,
} from './app-catalog.dtos';

/**
 * The full admin HTTP surface for the app catalog (Task 11 of the app-catalog
 * spec). Every route is a thin delegation to `AppCatalogService` — no
 * business logic lives here.
 */
@ApiTags('Admin - App Catalog')
@Controller('api/admin/apps')
@UseGuards(SessionAuthGuard, RolesGuard, FeatureFlagGuard)
@Roles('admin')
@RequireFeatureFlags('ENABLE_APP_CATALOG')
export class AppCatalogController {
  constructor(private readonly catalog: AppCatalogService) {}

  @Get()
  async list() {
    return this.catalog.listCatalog();
  }

  @Post(':appId/preflight')
  async preflight(
    @Param('appId') appId: string,
    @Body() body: PreflightRequestDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.catalog.preflight(appId, body, user.id);
  }

  @Post(':appId/install')
  async install(
    @Param('appId') appId: string,
    @Body() body: PreflightRequestDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.catalog.install(appId, body, user.id);
  }

  @Get('jobs/:jobId')
  async getJob(@Param('jobId') jobId: string) {
    return this.catalog.getJob(jobId);
  }

  @Post('jobs/:jobId/undo')
  async undoJob(@Param('jobId') jobId: string, @CurrentUser() user: CurrentUserData) {
    return this.catalog.undoJob(jobId, user.id);
  }

  @Post('installed/:id/update')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateInstalledAppDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.catalog.updateInstalled(id, body.prune ?? false, user.id);
  }

  @Get('installed/:id/uninstall-preview')
  async uninstallPreview(@Param('id') id: string) {
    return this.catalog.uninstallPreview(id);
  }

  @Delete('installed/:id')
  async uninstall(
    @Param('id') id: string,
    @Query() query: UninstallQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.catalog.uninstall(id, query.deleteData ?? false, user.id);
  }

  @Get('installed/:id/eject')
  async eject(@Param('id') id: string) {
    return this.catalog.ejectPayload(id);
  }

  @Post('installed/:id/ack-manual-step')
  async ack(@Param('id') id: string, @Body() body: AckManualStepDto) {
    const acked = await this.catalog.ackManualStep(id, body.stepId);
    return { acked };
  }
}
