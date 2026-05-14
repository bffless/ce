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
import { ProjectMembershipGuard } from './project-membership.guard';
import { initSuperTokens, syncOidcProviders } from './supertokens.config';
import { SettingsModule } from '../settings/settings.module';
import { SetupModule } from '../setup/setup.module';
import { OnboardingRulesModule } from '../onboarding-rules/onboarding-rules.module';
import { ProjectInviteLinksModule } from '../project-invite-links/project-invite-links.module';
import { DomainsModule } from '../domains/domains.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { VisibilityService } from '../domains/visibility.service';
import { ProjectResolverService } from './project-resolver.service';

@Module({
  imports: [DomainsModule],
  providers: [VisibilityService],
})
export class AuthModule implements NestModule {
  async onModuleInit() {
    await syncOidcProviders();
  }

  static forRoot(): DynamicModule {
    // Initialize SuperTokens
    initSuperTokens();

    return {
      module: AuthModule,
      global: true,
      imports: [
        forwardRef(() => SetupModule),
        forwardRef(() => OnboardingRulesModule),
        forwardRef(() => ProjectInviteLinksModule),
        forwardRef(() => DomainsModule),
        forwardRef(() => PermissionsModule),
        forwardRef(() => SettingsModule),
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
        ProjectMembershipGuard,
        VisibilityService, // Required for AuthMiddleware
        ProjectResolverService,
        {
          provide: APP_GUARD,
          useClass: EmailVerificationGuard,
        },
        {
          provide: APP_GUARD,
          useClass: ProjectMembershipGuard,
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
        ProjectMembershipGuard,
        ProjectResolverService,
      ],
    };
  }

  configure(consumer: MiddlewareConsumer) {
    // Apply SuperTokens middleware to all routes
    consumer.apply(AuthMiddleware).forRoutes('*');
  }
}
