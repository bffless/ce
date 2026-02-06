import { Module, Global } from '@nestjs/common';
import { EmailService } from './email.service';

/**
 * Email Module
 *
 * Provides the EmailService globally across the application.
 * This module is marked as @Global so it can be injected anywhere
 * without explicit imports.
 */
@Global()
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
