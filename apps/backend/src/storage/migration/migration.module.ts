import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { StorageMigrationService } from './migration.service';
import { MigrationController } from './migration.controller';
import { SetupModule } from '../../setup/setup.module';

@Module({
  imports: [EventEmitterModule.forRoot(), SetupModule],
  controllers: [MigrationController],
  providers: [StorageMigrationService],
  exports: [StorageMigrationService],
})
export class MigrationModule {}
