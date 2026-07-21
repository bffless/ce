import { Module } from '@nestjs/common';
import { SetupController } from './setup.controller';
import { SetupService } from './setup.service';
import { BootstrapSetupController } from './bootstrap-setup.controller';
import { BootstrapSetupService } from './bootstrap-setup.service';
import { BootstrapDnsPreflightService } from './bootstrap-dns-preflight.service';
import { EmailModule } from '../email/email.module';
import { AuthModule } from '../auth/auth.module';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';

@Module({
  imports: [EmailModule, AuthModule, FeatureFlagsModule],
  controllers: [SetupController, BootstrapSetupController],
  providers: [SetupService, BootstrapSetupService, BootstrapDnsPreflightService],
  exports: [SetupService],
})
export class SetupModule {}
