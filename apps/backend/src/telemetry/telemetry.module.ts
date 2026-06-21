import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TelemetryService } from './telemetry.service';

/**
 * TelemetryModule — wires the opt-out install telemetry phone-home.
 * See TelemetryService for what is sent and how to opt out.
 */
@Module({
  imports: [ConfigModule],
  providers: [TelemetryService],
  exports: [TelemetryService],
})
export class TelemetryModule {}
