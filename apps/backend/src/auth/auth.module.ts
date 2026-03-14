import { Module, NestModule, MiddlewareConsumer, DynamicModule, forwardRef } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { CustomDomainAuthController } from './custom-domain-auth.controller';
import { AuthService } from './auth.service';
import { DomainTokenService } from './domain-token.service';
import { CustomDomainAuthService } from './custom-domain-auth.service';
import { AuthMiddleware } from './auth.middleware';
import { SessionAuthGuard } from './session-auth.guard';
import { ApiKeyGuard } from './api-key.guard';
import { OptionalAuthGuard } from './optional-auth.guard';
import { RolesGuard } from './roles.guard';
import { EmailVerificationGuard } from './email-verification.guard';
import { initSuperTokens } from './supertokens.config';
import { SetupModule } from '../setup/setup.module';
import { OnboardingRulesModule } from '../onboarding-rules/onboarding-rules.module';
import { DomainsModule } from '../domains/domains.module';
import { VisibilityService } from '../domains/visibility.service';

@Module({
  imports: [DomainsModule],
  providers: [VisibilityService],
})
export class AuthModule implements NestModule {
  static forRoot(): DynamicModule {
    // Initialize SuperTokens
    initSuperTokens();

    return {
      module: AuthModule,
      global: true,
      imports: [
        forwardRef(() => SetupModule),
        forwardRef(() => OnboardingRulesModule),
        forwardRef(() => DomainsModule),
      ],
      controllers: [AuthController, CustomDomainAuthController],
      providers: [
        AuthService,
        DomainTokenService,
        CustomDomainAuthService,
        SessionAuthGuard,
        ApiKeyGuard,
        OptionalAuthGuard,
        RolesGuard,
        EmailVerificationGuard,
        VisibilityService, // Required for AuthMiddleware
        {
          provide: APP_GUARD,
          useClass: EmailVerificationGuard,
        },
      ],
      exports: [
        AuthService,
        DomainTokenService,
        CustomDomainAuthService,
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
