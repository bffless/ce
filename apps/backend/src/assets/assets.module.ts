import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { ProjectsModule } from '../projects/projects.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { StorageUsageModule } from '../storage/storage-usage.module';

@Module({
  imports: [
    MulterModule.register({
      limits: {
        fileSize: 100 * 1024 * 1024, // 100MB
        files: 50, // Max 50 files per request
      },
    }),
    ProjectsModule,
    PermissionsModule,
    StorageUsageModule,
  ],
  controllers: [AssetsController],
  providers: [AssetsService],
  exports: [AssetsService],
})
export class AssetsModule {}
