import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { FeatureFlagGuard, RequireFeatureFlags } from '../feature-flags/feature-flag.guard';
import { AppCatalogService } from './app-catalog.service';

@ApiTags('Admin - App Catalog')
@Controller('api/admin/apps')
@UseGuards(SessionAuthGuard, RolesGuard, FeatureFlagGuard)
@Roles('admin')
@RequireFeatureFlags('ENABLE_APP_CATALOG')
export class AppCatalogController {
  constructor(private readonly catalog: AppCatalogService) {}

  @Get()
  async list() {
    return { data: await this.catalog.listCatalog() };
  }
}
