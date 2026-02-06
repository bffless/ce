import { Module } from '@nestjs/common';
import { RepoBrowserController } from './repo-browser.controller';
import { RepoBrowserService } from './repo-browser.service';
import { PathPreferencesController } from './path-preferences.controller';
import { PathPreferencesService } from './path-preferences.service';
import { DeploymentsModule } from '../deployments/deployments.module';
import { ProjectsModule } from '../projects/projects.module';
import { PermissionsModule } from '../permissions/permissions.module';

@Module({
  imports: [DeploymentsModule, ProjectsModule, PermissionsModule],
  controllers: [RepoBrowserController, PathPreferencesController],
  providers: [RepoBrowserService, PathPreferencesService],
  exports: [RepoBrowserService, PathPreferencesService],
})
export class RepoBrowserModule {}
