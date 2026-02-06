import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { InternalController } from './internal.controller';
import { InternalSecretGuard } from './internal-secret.guard';
import { UsersModule } from '../users/users.module';

/**
 * InternalModule
 *
 * Provides internal API endpoints for Control Plane communication.
 *
 * Endpoints:
 * - GET /api/internal/users/:id - Fetch user details
 * - GET /api/internal/organizations/:id - Fetch organization details
 *
 * Security:
 * - All endpoints protected by InternalSecretGuard
 * - Requires X-Workspace-Secret header matching WORKSPACE_SECRET env var
 */
@Module({
  imports: [ConfigModule, UsersModule],
  controllers: [InternalController],
  providers: [InternalSecretGuard],
})
export class InternalModule {}
