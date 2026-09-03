import { Module } from '@nestjs/common';
import { AppTokensController } from './app-tokens.controller';
import { AppTokensService } from './app-tokens.service';
import { ProjectsModule } from '../projects/projects.module';
import { PermissionsModule } from '../permissions/permissions.module';

@Module({
  imports: [ProjectsModule, PermissionsModule],
  controllers: [AppTokensController],
  providers: [AppTokensService],
  exports: [AppTokensService],
})
export class AppTokensModule {}
