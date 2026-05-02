import { Module } from '@nestjs/common';
import { MeController } from './me.controller';
import { PermissionsModule } from '../permissions/permissions.module';

@Module({
  imports: [PermissionsModule],
  controllers: [MeController],
})
export class MeModule {}
