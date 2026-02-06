import { Module, NestModule, MiddlewareConsumer, DynamicModule, forwardRef } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthMiddleware } from './auth.middleware';
import { SessionAuthGuard } from './session-auth.guard';
import { ApiKeyGuard } from './api-key.guard';
import { OptionalAuthGuard } from './optional-auth.guard';
import { RolesGuard } from './roles.guard';
import { EmailVerificationGuard } from './email-verification.guard';
import { initSuperTokens } from './supertokens.config';
import { SetupModule } from '../setup/setup.module';

@Module({})
export class AuthModule implements NestModule {
  static forRoot(): DynamicModule {
    // Initialize SuperTokens
    initSuperTokens();

    return {
      module: AuthModule,
      global: true,
      imports: [forwardRef(() => SetupModule)],
      controllers: [AuthController],
      providers: [
        AuthService,
        SessionAuthGuard,
        ApiKeyGuard,
        OptionalAuthGuard,
        RolesGuard,
        EmailVerificationGuard,
        {
          provide: APP_GUARD,
          useClass: EmailVerificationGuard,
        },
      ],
      exports: [
        AuthService,
        SessionAuthGuard,
        ApiKeyGuard,
        OptionalAuthGuard,
        RolesGuard,
        EmailVerificationGuard,
      ],
    };
  }

  configure(consumer: MiddlewareConsumer) {
    // Apply SuperTokens middleware to all routes
    consumer.apply(AuthMiddleware).forRoutes('*');
  }
}
