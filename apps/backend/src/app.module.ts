import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_FILTER } from '@nestjs/core';
import { GlobalExceptionFilter } from './common/filters';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SetupModule } from './setup/setup.module';
import { SetupService } from './setup/setup.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { StorageModule, StorageModuleConfig } from './storage/storage.module';
import { CacheModule } from './storage/cache/cache.module';
import { CacheConfig } from './storage/cache/cache.interface';
import { MigrationModule } from './storage/migration/migration.module';
import { AssetsModule } from './assets/assets.module';
import { DeploymentsModule } from './deployments/deployments.module';
import { RepoBrowserModule } from './repo-browser/repo-browser.module';
import { ProjectsModule } from './projects/projects.module';
import { UserGroupsModule } from './user-groups/user-groups.module';
import { PermissionsModule } from './permissions/permissions.module';
import { DomainsModule } from './domains/domains.module';
import { SettingsModule } from './settings/settings.module';
import { ProxyRulesModule } from './proxy-rules/proxy-rules.module';
import { FeatureFlagsModule } from './feature-flags/feature-flags.module';
import { InternalModule } from './internal/internal.module';
import { TenantMiddleware } from './auth/tenant.middleware';
import { PlatformAliasCookieMiddleware } from './auth/platform-alias-cookie.middleware';
import { InvitationsModule } from './invitations/invitations.module';
import { RetentionModule } from './retention/retention.module';
import { CacheRulesModule } from './cache-rules/cache-rules.module';
import { ShareLinksModule } from './share-links/share-links.module';
import { PlatformModule } from './platform/platform.module';
import { StorageUsageModule } from './storage/storage-usage.module';
import { OnboardingRulesModule } from './onboarding-rules/onboarding-rules.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '../../.env',
    }),
    // Rate limiting - 100 requests per minute per IP
    ThrottlerModule.forRoot([
      {
        ttl: 60000, // 1 minute in milliseconds
        limit: 100, // 100 requests per minute
      },
    ]),
    // Platform module provides L1 → L2 communication services (global)
    PlatformModule,
    AuthModule.forRoot(),
    SetupModule,
    FeatureFlagsModule,
    CacheModule.forRootAsync({
      imports: [SetupModule],
      inject: [SetupService],
      useFactory: async (setupService: SetupService): Promise<CacheConfig> => {
        return setupService.getCacheConfig();
      },
    }),
    StorageModule.forRootAsync({
      imports: [SetupModule],
      inject: [SetupService],
      useFactory: async (setupService: SetupService): Promise<StorageModuleConfig> => {
        const storageConfig = await setupService.getStorageConfig();
        const systemConfig = await setupService.getSystemConfig();
        const cacheConfig = await setupService.getCacheConfig();

        // Return default config if setup not complete
        if (!storageConfig || !systemConfig?.storageProvider) {
          // Check for managed storage env vars (PaaS deployments)
          const managedStorageConfig = setupService.getManagedStorageConfig();
          if (managedStorageConfig) {
            // Add keyPrefix for workspace isolation
            const keyPrefix = setupService.getManagedStoragePrefix();
            return {
              storageType: setupService.getManagedStorageType(),
              config: { ...managedStorageConfig, keyPrefix },
              cacheConfig,
            };
          }

          return {
            storageType: 'local',
            config: { localPath: './uploads' },
            cacheConfig,
          };
        }

        // For PaaS deployments, add keyPrefix for workspace isolation
        // even when using database config
        const keyPrefix = setupService.getManagedStoragePrefix();

        // Handle 'managed' storage provider - use managed storage config from env vars
        if (systemConfig.storageProvider === 'managed') {
          const managedStorageConfig = setupService.getManagedStorageConfig();
          if (managedStorageConfig) {
            return {
              storageType: setupService.getManagedStorageType(),
              config: { ...managedStorageConfig, keyPrefix },
              cacheConfig,
            };
          }
          // Fall back to local if managed storage env vars not configured
          return {
            storageType: 'local',
            config: { localPath: './uploads' },
            cacheConfig,
          };
        }

        const configWithPrefix = keyPrefix ? { ...storageConfig, keyPrefix } : storageConfig;

        return {
          storageType: systemConfig.storageProvider as 'local' | 'minio' | 's3' | 'gcs' | 'azure',
          config: configWithPrefix,
          cacheConfig,
        };
      },
    }),
    UsersModule,
    ApiKeysModule,
    AssetsModule,
    DeploymentsModule,
    RepoBrowserModule,
    // ProxyRulesModule, RetentionModule, and CacheRulesModule must be imported BEFORE ProjectsModule because:
    // - ProxyRulesController has route: GET /api/projects/:projectId/proxy-rules
    // - RetentionController has route: GET /api/projects/:projectId/retention-rules
    // - CacheRulesController has route: GET /api/cache-rules/project/:projectId
    // - ProjectsController has route: GET /api/projects/:owner/:name
    // The more specific routes must be registered first to avoid
    // the generic :owner/:name route matching them as a name.
    ProxyRulesModule,
    RetentionModule,
    CacheRulesModule,
    ShareLinksModule,    // Must come BEFORE ProjectsModule (route ordering)
    ProjectsModule,
    UserGroupsModule,
    PermissionsModule,
    DomainsModule,
    SettingsModule,
    MigrationModule,
    InternalModule,
    InvitationsModule,
    StorageUsageModule,
    OnboardingRulesModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Global exception filter - strips stack traces in production
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    // Apply rate limiting globally
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Apply middleware chain to all routes
    // Order matters: PlatformAliasCookieMiddleware must run before TenantMiddleware
    // to intercept Set-Cookie headers before auth runs
    consumer
      .apply(PlatformAliasCookieMiddleware, TenantMiddleware)
      .forRoutes('*');
  }
}
