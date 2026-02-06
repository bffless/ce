import {
  Injectable,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  Logger,
  Inject,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { db } from '../db/client';
import { systemConfig, users } from '../db/schema';
import { eq } from 'drizzle-orm';
import * as crypto from 'crypto';
import EmailPassword from 'supertokens-node/recipe/emailpassword';
import { createUserIdMapping, listUsersByAccountInfo, getUserIdMapping } from 'supertokens-node';
import {
  InitializeSystemDto,
  ConfigureStorageDto,
  CompleteSetupDto,
  SetupStatusResponseDto,
  InitializeResponseDto,
  StorageConfigResponseDto,
  CompleteSetupResponseDto,
  StorageProvider,
  EnvStorageConfigResponseDto,
  ConfigureSmtpDto,
  SmtpConfigResponseDto,
  TestSmtpResponseDto,
  EnvSmtpConfigResponseDto,
  ConfigureEmailDto,
  ConfigureEmailResponseDto,
  TestEmailResponseDto,
  GetEmailProvidersResponseDto,
  S3StorageConfigDto,
  EmailProvider,
} from './setup.dto';
import { CacheConfig } from '../storage/cache/cache.interface';
import * as nodemailer from 'nodemailer';
import { EmailService } from '../email/email.service';
import {
  EMAIL_PROVIDER_METADATA,
  EmailProviderType,
} from '../email/interfaces/provider-configs.interface';
import { getImplementedProviders } from '../email/providers';
import { DynamicStorageAdapter } from '../storage/dynamic-storage.adapter';
import { DYNAMIC_STORAGE_ADAPTER, StorageModule } from '../storage/storage.module';
import { ModuleRef } from '@nestjs/core';
import { CACHE_ADAPTER, ICacheAdapter } from '../storage/cache/cache.interface';
import { CachingStorageAdapter } from '../storage/cache/caching-storage.adapter';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { AvailableOptionsResponseDto } from './setup.dto';
import { UsageReporterService } from '../platform/usage-reporter.service';

/**
 * Service constraints response - indicates which optional services are enabled/disabled
 */
export interface ServiceConstraint {
  enabled: boolean;
  reason: string | null;
}

export interface ServiceConstraints {
  minio: ServiceConstraint;
  redis: ServiceConstraint;
}

@Injectable()
export class SetupService {
  private readonly logger = new Logger(SetupService.name);
  private readonly ENCRYPTION_KEY: Buffer;
  private readonly ENCRYPTION_ALGORITHM = 'aes-256-gcm';

  // SuperTokens tenant ID - matches logic in supertokens.config.ts
  private readonly superTokensTenantId: string;

  // Cache configuration cache (to avoid DB queries on every request)
  private cachedCacheConfig: CacheConfig | null = null;
  private cacheConfigLoadedAt: number = 0;
  private readonly CACHE_CONFIG_TTL = 60000; // 1 minute cache

  // Onboarding token from environment (for secure workspace setup)
  private readonly onboardingToken: string | null;

  constructor(
    private configService: ConfigService,
    private emailService: EmailService,
    private moduleRef: ModuleRef,
    private featureFlagsService: FeatureFlagsService,
    private usageReporterService: UsageReporterService,
    @Optional()
    @Inject(DYNAMIC_STORAGE_ADAPTER)
    private dynamicStorageAdapter?: DynamicStorageAdapter,
    @Optional()
    @Inject(CACHE_ADAPTER)
    private cacheAdapter?: ICacheAdapter,
  ) {
    // Get or generate encryption key for storage credentials
    const encryptionKey = this.configService.get<string>('ENCRYPTION_KEY');
    if (encryptionKey) {
      this.ENCRYPTION_KEY = Buffer.from(encryptionKey, 'base64');
    } else {
      // Generate a key for development (in production, this should be set via env)
      this.ENCRYPTION_KEY = crypto.randomBytes(32);
      this.logger.warn(
        'No ENCRYPTION_KEY found in environment. Generated temporary key. Set ENCRYPTION_KEY in production!',
      );
    }

    // Determine SuperTokens tenant ID (matches logic in supertokens.config.ts)
    const isMultiTenant = this.configService.get<string>('SUPERTOKENS_MULTI_TENANT') === 'true';
    this.superTokensTenantId = isMultiTenant
      ? this.configService.get<string>('ORGANIZATION_ID') ||
        this.configService.get<string>('TENANT_ID') ||
        'public'
      : 'public';

    if (this.dynamicStorageAdapter) {
      this.logger.log(
        `SetupService initialized with DynamicStorageAdapter [${this.dynamicStorageAdapter.getInstanceId()}]`,
      );
    } else {
      this.logger.log(
        'SetupService initialized without DynamicStorageAdapter (will use moduleRef)',
      );
    }

    // Get onboarding token from environment (for secure workspace setup)
    this.onboardingToken = this.configService.get<string>('ONBOARDING_TOKEN') || null;
    if (this.onboardingToken) {
      this.logger.log('Onboarding token configured - admin creation will require valid token');
    }
  }

  /**
   * Validate onboarding token for secure workspace setup.
   * - If ONBOARDING_TOKEN is set in env, the provided token must match
   * - If ONBOARDING_TOKEN is not set, validation is skipped (CE mode backwards compatibility)
   * - This prevents unauthorized users from claiming admin access to new workspaces
   */
  private validateOnboardingToken(providedToken?: string): void {
    // If no token configured in environment, skip validation (CE mode)
    if (!this.onboardingToken) {
      return;
    }

    // Token is configured, so it must be provided and match
    if (!providedToken) {
      throw new BadRequestException(
        'Onboarding token is required. Please use the setup link provided during workspace provisioning.',
      );
    }

    if (providedToken !== this.onboardingToken) {
      throw new BadRequestException(
        'Invalid onboarding token. Please use the correct setup link.',
      );
    }
  }

  /**
   * Check if system setup is complete
   */
  async getSetupStatus(): Promise<SetupStatusResponseDto> {
    try {
      const config = await this.getSystemConfig();
      const adminUsers = await db.select().from(users).where(eq(users.role, 'admin')).limit(1);

      return {
        isSetupComplete: config?.isSetupComplete || false,
        storageProvider: config?.storageProvider || undefined,
        hasAdminUser: adminUsers.length > 0,
        // New email provider fields
        emailConfigured: config?.emailConfigured || false,
        emailProvider: config?.emailProvider || undefined,
        // Legacy SMTP field (for backwards compatibility)
        smtpConfigured: config?.smtpConfigured || config?.emailConfigured || false,
      };
    } catch (error) {
      this.logger.error('Error checking setup status:', error);
      throw new InternalServerErrorException('Failed to check setup status');
    }
  }

  /**
   * Get service constraints from environment variables.
   * These are set by the user in .env and control which optional Docker services are available.
   *
   * When ENABLE_MINIO=false:
   * - MinIO Docker container is not started (via docker-compose profiles)
   * - Backend rejects MinIO storage selection
   * - Frontend disables MinIO option in storage selection
   *
   * When ENABLE_REDIS=false:
   * - Redis Docker container is not started (via docker-compose profiles)
   * - Backend rejects Redis cache selection
   * - Frontend disables Redis option in cache selection
   */
  getServiceConstraints(): ServiceConstraints {
    const enableMinio = this.configService.get('ENABLE_MINIO', 'true') === 'true';
    const enableRedis = this.configService.get('ENABLE_REDIS', 'true') === 'true';

    return {
      minio: {
        enabled: enableMinio,
        reason: enableMinio ? null : 'ENABLE_MINIO=false is set in your .env file',
      },
      redis: {
        enabled: enableRedis,
        reason: enableRedis ? null : 'ENABLE_REDIS=false is set in your .env file',
      },
    };
  }

  /**
   * Get available options for storage, cache, and email based on feature flags.
   * Used by both setup wizard and admin settings to filter available options.
   */
  async getAvailableOptions(): Promise<AvailableOptionsResponseDto> {
    const [
      // Storage flags
      enableManagedStorage,
      enableByobS3,
      enableByobGcs,
      enableByobAzure,
      enableLocalStorage,
      enableMinioStorage,
      // Cache flags
      enableLruCache,
      enableManagedRedis,
      enableLocalRedis,
      enableExternalRedis,
      skipCacheStep,
      defaultCacheType,
      // Email flags
      enableManagedEmail,
      enableSmtp,
      enableSendgrid,
      enableResend,
      enableSkipEmail,
      skipEmailStep,
      defaultEmailType,
      // UI display flags
      enableEnvOptimizationHints,
      enableSettingsUpdateNote,
    ] = await Promise.all([
      // Storage flags
      this.featureFlagsService.isEnabled('ENABLE_MANAGED_STORAGE'),
      this.featureFlagsService.isEnabled('ENABLE_BYOB_S3'),
      this.featureFlagsService.isEnabled('ENABLE_BYOB_GCS'),
      this.featureFlagsService.isEnabled('ENABLE_BYOB_AZURE'),
      this.featureFlagsService.isEnabled('ENABLE_LOCAL_STORAGE'),
      this.featureFlagsService.isEnabled('ENABLE_MINIO_STORAGE'),
      // Cache flags
      this.featureFlagsService.isEnabled('ENABLE_LRU_CACHE'),
      this.featureFlagsService.isEnabled('ENABLE_MANAGED_REDIS'),
      this.featureFlagsService.isEnabled('ENABLE_LOCAL_REDIS'),
      this.featureFlagsService.isEnabled('ENABLE_EXTERNAL_REDIS'),
      this.featureFlagsService.isEnabled('SKIP_CACHE_STEP'),
      this.featureFlagsService.get('DEFAULT_CACHE_TYPE'),
      // Email flags
      this.featureFlagsService.isEnabled('ENABLE_MANAGED_EMAIL'),
      this.featureFlagsService.isEnabled('ENABLE_SMTP'),
      this.featureFlagsService.isEnabled('ENABLE_SENDGRID'),
      this.featureFlagsService.isEnabled('ENABLE_RESEND'),
      this.featureFlagsService.isEnabled('ENABLE_SKIP_EMAIL'),
      this.featureFlagsService.isEnabled('SKIP_EMAIL_STEP'),
      this.featureFlagsService.get('DEFAULT_EMAIL_TYPE'),
      // UI display flags
      this.featureFlagsService.isEnabled('ENABLE_ENV_OPTIMIZATION_HINTS'),
      this.featureFlagsService.isEnabled('ENABLE_SETTINGS_UPDATE_NOTE'),
    ]);

    // Also check service constraints for MinIO and Redis
    const constraints = this.getServiceConstraints();

    // Check if managed service credentials are actually configured
    const managedStorageConfigured = this.getManagedStorageConfig() !== null;
    const managedRedisConfigured = this.getManagedRedisConfig() !== null;
    const managedEmailConfigured = this.getManagedEmailConfig() !== null;

    return {
      storage: {
        // Managed storage requires both flag AND credentials
        managed: enableManagedStorage && managedStorageConfigured,
        s3: enableByobS3,
        gcs: enableByobGcs,
        azure: enableByobAzure,
        local: enableLocalStorage,
        minio: enableMinioStorage && constraints.minio.enabled, // Also check ENABLE_MINIO env var
      },
      cache: {
        lru: enableLruCache,
        // Managed Redis requires both flag AND credentials (MANAGED_REDIS_HOST set)
        managedRedis: enableManagedRedis && managedRedisConfigured,
        // Local Redis is never available on platform (features.json sets ENABLE_LOCAL_REDIS=false)
        localRedis: enableLocalRedis && constraints.redis.enabled,
        externalRedis: enableExternalRedis,
        skipStep: skipCacheStep,
        defaultType: (defaultCacheType as string) || 'memory',
      },
      email: {
        // Managed email requires both flag AND credentials
        managed: enableManagedEmail && managedEmailConfigured,
        smtp: enableSmtp,
        sendgrid: enableSendgrid,
        resend: enableResend,
        skipAllowed: enableSkipEmail,
        skipStep: skipEmailStep,
        defaultType: (defaultEmailType as string) || '',
      },
      ui: {
        enableEnvOptimizationHints,
        enableSettingsUpdateNote,
      },
    };
  }

  /**
   * Initialize system with first admin user
   */
  async initialize(dto: InitializeSystemDto): Promise<InitializeResponseDto> {
    // Validate onboarding token (prevents unauthorized admin creation)
    this.validateOnboardingToken(dto.token);

    // Check if setup is already complete
    const status = await this.getSetupStatus();
    if (status.isSetupComplete) {
      throw new ConflictException('System setup is already complete');
    }

    // Check if admin user already exists
    if (status.hasAdminUser) {
      throw new ConflictException('Admin user already exists');
    }

    try {
      // Check if user with this email already exists
      const existingUser = await db.select().from(users).where(eq(users.email, dto.email)).limit(1);

      if (existingUser.length > 0) {
        throw new ConflictException('User with this email already exists');
      }

      // Create admin user in our database first
      const [newUser] = await db
        .insert(users)
        .values({
          email: dto.email,
          role: 'admin',
        })
        .returning();

      // Create user in SuperTokens
      const signUpResponse = await EmailPassword.signUp(
        this.superTokensTenantId,
        dto.email,
        dto.password,
      );

      if (signUpResponse.status === 'EMAIL_ALREADY_EXISTS_ERROR') {
        // Rollback: delete the database user we just created
        await db.delete(users).where(eq(users.id, newUser.id));
        throw new ConflictException('Email already exists in authentication system');
      }

      if (signUpResponse.status !== 'OK') {
        // Rollback: delete the database user we just created
        await db.delete(users).where(eq(users.id, newUser.id));
        throw new InternalServerErrorException('Failed to create SuperTokens user');
      }

      // Create user ID mapping so SuperTokens uses our database user ID
      await createUserIdMapping({
        superTokensUserId: signUpResponse.recipeUserId.getAsString(),
        externalUserId: newUser.id,
      });

      // Initialize system config if it doesn't exist
      let config = await this.getSystemConfig();
      if (!config) {
        const jwtSecret = this.generateSecret(64);
        const apiKeySalt = this.generateSecret(32);

        [config] = await db
          .insert(systemConfig)
          .values({
            isSetupComplete: false,
            jwtSecret,
            apiKeySalt,
          })
          .returning();
      }

      this.logger.log(`Admin user created with SuperTokens user ID mapping: ${newUser.email}`);

      return {
        message: 'Admin user created successfully',
        userId: newUser.id,
        email: newUser.email,
      };
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      this.logger.error('Error initializing system:', error);
      throw new InternalServerErrorException('Failed to initialize system');
    }
  }

  /**
   * Configure storage backend
   */
  async configureStorage(dto: ConfigureStorageDto): Promise<StorageConfigResponseDto> {
    const status = await this.getSetupStatus();
    if (status.isSetupComplete) {
      throw new BadRequestException('Cannot modify storage configuration after setup is complete');
    }

    // Validate against service constraints (ENABLE_* env vars)
    const constraints = this.getServiceConstraints();
    if (dto.storageProvider === StorageProvider.MINIO && !constraints.minio.enabled) {
      throw new BadRequestException(
        'MinIO storage is not available. ENABLE_MINIO=false is set in your .env file. ' +
          'Either select a different storage provider, or update your .env file and restart Docker.',
      );
    }

    // Validate against feature flags
    const availableOptions = await this.getAvailableOptions();
    const storageProviderFlags: Record<string, boolean> = {
      [StorageProvider.MANAGED]: availableOptions.storage.managed,
      [StorageProvider.S3]: availableOptions.storage.s3,
      [StorageProvider.GCS]: availableOptions.storage.gcs,
      [StorageProvider.AZURE]: availableOptions.storage.azure,
      [StorageProvider.LOCAL]: availableOptions.storage.local,
      [StorageProvider.MINIO]: availableOptions.storage.minio,
    };

    if (!storageProviderFlags[dto.storageProvider]) {
      throw new BadRequestException(
        `Storage provider '${dto.storageProvider}' is not available. ` +
          'This option is disabled by feature flags.',
      );
    }

    try {
      // Handle MANAGED storage - load config from environment variables
      let actualConfig = dto.config;
      let actualProvider = dto.storageProvider;

      if (dto.storageProvider === StorageProvider.MANAGED) {
        const managedConfig = this.getManagedStorageConfig();
        if (!managedConfig) {
          throw new BadRequestException(
            'Managed storage is not configured. MANAGED_STORAGE_* environment variables are missing.',
          );
        }
        // Managed storage uses S3 adapter with platform credentials
        actualProvider = StorageProvider.S3;
        actualConfig = managedConfig;
      }

      // Validate storage configuration
      this.validateStorageConfig(actualProvider, actualConfig);

      // Encrypt sensitive storage configuration
      const encryptedConfig = this.encryptData(JSON.stringify(actualConfig));

      // Get or create system config
      const config = await this.getSystemConfig();

      if (config) {
        // Update existing config
        await db
          .update(systemConfig)
          .set({
            storageProvider: dto.storageProvider,
            storageConfig: encryptedConfig,
            updatedAt: new Date(),
          })
          .where(eq(systemConfig.id, config.id));
      } else {
        // Create new config
        const jwtSecret = this.generateSecret(64);
        const apiKeySalt = this.generateSecret(32);

        await db.insert(systemConfig).values({
          isSetupComplete: false,
          storageProvider: dto.storageProvider,
          storageConfig: encryptedConfig,
          jwtSecret,
          apiKeySalt,
        });
      }

      this.logger.log(`Storage configured: ${dto.storageProvider}`);

      return {
        message: 'Storage configured successfully',
        storageProvider: dto.storageProvider,
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error('Error configuring storage:', error);
      throw new InternalServerErrorException('Failed to configure storage');
    }
  }

  /**
   * Test storage connection using the configured adapter
   * On success, swaps the dynamic storage adapter to use the new configuration
   */
  async testStorageConnection(): Promise<{ success: boolean; message: string; error?: string }> {
    try {
      const config = await this.getSystemConfig();

      if (!config || !config.storageProvider || !config.storageConfig) {
        throw new BadRequestException('Storage not configured');
      }

      // Decrypt storage config
      const storageConfig = JSON.parse(this.decryptData(config.storageConfig));

      // Validate storage configuration structure
      this.validateStorageConfig(config.storageProvider as StorageProvider, storageConfig);

      // Create storage adapter and test connection
      const adapter = await this.createStorageAdapter(
        config.storageProvider as StorageProvider,
        storageConfig,
      );
      const connectionSuccess = await adapter.testConnection();

      if (!connectionSuccess) {
        throw new Error('Storage adapter connection test failed');
      }

      this.logger.log(`Storage connection test passed for ${config.storageProvider}`);

      // Swap the dynamic adapter to use the new storage configuration
      // This allows the app to use the new storage without restarting
      try {
        // Prefer injected instance, fall back to moduleRef
        let dynamicAdapter = this.dynamicStorageAdapter;
        if (dynamicAdapter) {
          this.logger.log(
            `Using injected DynamicStorageAdapter [${dynamicAdapter.getInstanceId()}]`,
          );
        } else {
          this.logger.log('No injected adapter, attempting moduleRef.get()...');
          dynamicAdapter = this.moduleRef.get<DynamicStorageAdapter>(DYNAMIC_STORAGE_ADAPTER, {
            strict: false,
          });
          this.logger.log(
            `moduleRef.get() returned: ${dynamicAdapter ? 'instance' : 'null/undefined'}`,
          );
        }

        if (dynamicAdapter) {
          this.logger.log(
            `Found DynamicStorageAdapter instance [${dynamicAdapter.getInstanceId()}], current adapter: ${dynamicAdapter.getAdapterType()}`,
          );
          const mappedConfig = await this.getStorageConfig();
          // Add keyPrefix for workspace isolation (PaaS deployments)
          const keyPrefix = this.getManagedStoragePrefix();
          const configWithPrefix = keyPrefix ? { ...mappedConfig, keyPrefix } : mappedConfig;
          // Managed storage uses S3 adapter under the hood
          const effectiveStorageType =
            config.storageProvider === StorageProvider.MANAGED ? 's3' : config.storageProvider;
          let newAdapter = StorageModule.createAdapter({
            storageType: effectiveStorageType as 'local' | 'minio' | 's3' | 'gcs' | 'azure',
            config: configWithPrefix,
          });

          // Wrap with caching layer if cache adapter is available
          const cacheConfig = await this.getCacheConfig();
          if (this.cacheAdapter && cacheConfig.enabled !== false) {
            this.logger.log('Wrapping storage adapter with caching layer');
            newAdapter = new CachingStorageAdapter(newAdapter, this.cacheAdapter, cacheConfig);
          }

          dynamicAdapter.setAdapter(newAdapter);
          this.logger.log(
            `Storage adapter swapped to ${config.storageProvider} on instance [${dynamicAdapter.getInstanceId()}] (no restart needed)`,
          );
        } else {
          this.logger.warn(
            'DynamicStorageAdapter not available (null/undefined) - storage will be updated on next restart',
          );
        }
      } catch (err) {
        this.logger.error(`Failed to get DynamicStorageAdapter: ${err.message}`);
        this.logger.error(err.stack);
        this.logger.warn('Storage will be updated on next restart');
      }

      return {
        success: true,
        message: `Successfully connected to ${config.storageProvider} storage`,
      };
    } catch (error) {
      this.logger.error('Storage connection test failed:', error);
      return {
        success: false,
        message: 'Storage connection test failed',
        error: error.message,
      };
    }
  }

  /**
   * Create a storage adapter instance based on provider and config
   * This is used for testing during setup
   */
  private async createStorageAdapter(provider: StorageProvider, config: any): Promise<any> {
    switch (provider) {
      case StorageProvider.LOCAL: {
        const { LocalStorageAdapter } = await import('../storage/local.adapter');
        return new LocalStorageAdapter({
          localPath: config.localPath,
          baseUrl: config.baseUrl,
        });
      }

      case StorageProvider.MINIO: {
        const { MinioStorageAdapter } = await import('../storage/minio.adapter');
        return new MinioStorageAdapter({
          endPoint: config.endpoint,
          port: config.port || 9000,
          useSSL: config.useSSL || false,
          accessKey: config.accessKey,
          secretKey: config.secretKey,
          bucket: config.bucket,
          region: config.region || 'us-east-1',
        });
      }

      case StorageProvider.S3: {
        const { S3StorageAdapter } = await import('../storage/s3.adapter');
        return new S3StorageAdapter({
          region: config.region,
          bucket: config.bucket,
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
          endpoint: config.endpoint,
          forcePathStyle: config.forcePathStyle,
          presignedUrlExpiration: config.presignedUrlExpiration,
        });
      }

      case StorageProvider.GCS: {
        const { GcsStorageAdapter } = await import('../storage/gcs.adapter');
        return new GcsStorageAdapter({
          projectId: config.projectId,
          bucket: config.bucket,
          credentials: config.credentials,
          keyFilename: config.keyFilename,
          storageClass: config.storageClass,
          signedUrlExpiration: config.signedUrlExpiration,
          useApplicationDefaultCredentials: config.useApplicationDefaultCredentials,
        });
      }

      case StorageProvider.AZURE: {
        const { AzureBlobStorageAdapter } = await import('../storage/azure.adapter');
        return new AzureBlobStorageAdapter({
          accountName: config.accountName,
          containerName: config.containerName,
          accountKey: config.accountKey,
          connectionString: config.connectionString,
          useManagedIdentity: config.useManagedIdentity,
          managedIdentityClientId: config.managedIdentityClientId,
          accessTier: config.accessTier,
          sasUrlExpiration: config.sasUrlExpiration,
          endpoint: config.endpoint,
        });
      }

      case StorageProvider.MANAGED: {
        // Managed storage uses S3 adapter with platform-provided credentials
        const { S3StorageAdapter } = await import('../storage/s3.adapter');
        return new S3StorageAdapter({
          region: config.region,
          bucket: config.bucket,
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
          endpoint: config.endpoint,
          forcePathStyle: config.forcePathStyle,
          presignedUrlExpiration: config.presignedUrlExpiration,
        });
      }

      default:
        throw new BadRequestException(`Unsupported storage provider: ${provider}`);
    }
  }

  /**
   * Mark setup as complete
   */
  async completeSetup(dto: CompleteSetupDto): Promise<CompleteSetupResponseDto> {
    if (!dto.confirm) {
      throw new BadRequestException('Setup confirmation required');
    }

    const status = await this.getSetupStatus();

    if (status.isSetupComplete) {
      throw new ConflictException('Setup is already complete');
    }

    // Validate prerequisites
    if (!status.hasAdminUser) {
      throw new BadRequestException('Admin user must be created before completing setup');
    }

    if (!status.storageProvider) {
      throw new BadRequestException('Storage must be configured before completing setup');
    }

    try {
      const config = await this.getSystemConfig();
      if (!config) {
        throw new InternalServerErrorException('System configuration not found');
      }

      await db
        .update(systemConfig)
        .set({
          isSetupComplete: true,
          updatedAt: new Date(),
        })
        .where(eq(systemConfig.id, config.id));

      this.logger.log('System setup completed');

      // Enable email verification if email was configured during setup
      if (config.emailConfigured) {
        await this.featureFlagsService.setFlag('ENABLE_EMAIL_VERIFICATION', true);
        this.logger.log('Email verification enabled (email provider configured)');
      }

      // Report setup completion to Control Plane (fire-and-forget)
      // This is a no-op for self-hosted CE (when CONTROL_PLANE_URL is not set)
      this.usageReporterService.reportSetupComplete().catch(() => {
        // Ignore errors - this is fire-and-forget
      });

      return {
        message: 'Setup completed successfully',
        isSetupComplete: true,
      };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ConflictException) {
        throw error;
      }
      this.logger.error('Error completing setup:', error);
      throw new InternalServerErrorException('Failed to complete setup');
    }
  }

  /**
   * Get system configuration from database
   */
  async getSystemConfig() {
    const configs = await db.select().from(systemConfig).limit(1);
    return configs.length > 0 ? configs[0] : null;
  }

  /**
   * Get decrypted storage configuration mapped to adapter format
   */
  async getStorageConfig(): Promise<any> {
    const config = await this.getSystemConfig();
    if (!config || !config.storageConfig || !config.storageProvider) {
      return null;
    }

    const rawConfig = JSON.parse(this.decryptData(config.storageConfig));

    // Map stored config to adapter-expected format
    switch (config.storageProvider) {
      case StorageProvider.LOCAL:
        return {
          localPath: rawConfig.localPath,
          baseUrl: rawConfig.baseUrl,
        };

      case StorageProvider.MINIO:
        return {
          endPoint: rawConfig.endpoint,
          port:
            typeof rawConfig.port === 'string'
              ? parseInt(rawConfig.port, 10)
              : rawConfig.port || 9000,
          useSSL: rawConfig.useSSL || false,
          accessKey: rawConfig.accessKey,
          secretKey: rawConfig.secretKey,
          bucket: rawConfig.bucket,
          region: rawConfig.region || 'us-east-1',
        };

      case StorageProvider.S3:
        return {
          region: rawConfig.region,
          bucket: rawConfig.bucket,
          accessKeyId: rawConfig.accessKeyId,
          secretAccessKey: rawConfig.secretAccessKey,
          endpoint: rawConfig.endpoint,
          forcePathStyle: rawConfig.forcePathStyle,
          presignedUrlExpiration: rawConfig.presignedUrlExpiration,
        };

      case StorageProvider.GCS:
        return {
          projectId: rawConfig.projectId,
          bucket: rawConfig.bucket,
          credentials: rawConfig.credentials,
          keyFilename: rawConfig.keyFilename,
          storageClass: rawConfig.storageClass,
          signedUrlExpiration: rawConfig.signedUrlExpiration,
          useApplicationDefaultCredentials: rawConfig.useApplicationDefaultCredentials,
        };

      case StorageProvider.AZURE:
        return {
          accountName: rawConfig.accountName,
          containerName: rawConfig.containerName,
          accountKey: rawConfig.accountKey,
          connectionString: rawConfig.connectionString,
          useManagedIdentity: rawConfig.useManagedIdentity,
          managedIdentityClientId: rawConfig.managedIdentityClientId,
          accessTier: rawConfig.accessTier,
          sasUrlExpiration: rawConfig.sasUrlExpiration,
          endpoint: rawConfig.endpoint,
        };

      case StorageProvider.MANAGED:
        // Managed storage uses S3 adapter config format
        return {
          region: rawConfig.region,
          bucket: rawConfig.bucket,
          accessKeyId: rawConfig.accessKeyId,
          secretAccessKey: rawConfig.secretAccessKey,
          endpoint: rawConfig.endpoint,
          forcePathStyle: rawConfig.forcePathStyle,
          presignedUrlExpiration: rawConfig.presignedUrlExpiration,
        };

      default:
        return rawConfig;
    }
  }

  /**
   * Get current storage configuration details (non-sensitive info only)
   * Returns bucket, region, endpoint, etc. but NOT access keys or secrets
   */
  async getCurrentStorageConfigDetails(): Promise<{
    isConfigured: boolean;
    storageProvider?: string;
    endpoint?: string;
    port?: number;
    bucket?: string;
    containerName?: string;
    region?: string;
    useSSL?: boolean;
    localPath?: string;
    projectId?: string;
    accountName?: string;
    isS3Compatible?: boolean;
    storageClass?: string;
    accessTier?: string;
  }> {
    const config = await this.getSystemConfig();
    if (!config || !config.storageConfig || !config.storageProvider) {
      return { isConfigured: false };
    }

    try {
      const rawConfig = JSON.parse(this.decryptData(config.storageConfig));

      switch (config.storageProvider) {
        case StorageProvider.LOCAL:
          return {
            isConfigured: true,
            storageProvider: config.storageProvider,
            localPath: rawConfig.localPath,
          };

        case StorageProvider.MINIO:
          return {
            isConfigured: true,
            storageProvider: config.storageProvider,
            endpoint: rawConfig.endpoint,
            port: rawConfig.port,
            bucket: rawConfig.bucket,
            useSSL: rawConfig.useSSL,
            region: rawConfig.region,
          };

        case StorageProvider.S3:
          return {
            isConfigured: true,
            storageProvider: config.storageProvider,
            bucket: rawConfig.bucket,
            region: rawConfig.region,
            endpoint: rawConfig.endpoint,
            // Determine if S3-compatible based on whether a custom endpoint is set
            isS3Compatible: !!rawConfig.endpoint,
          };

        case StorageProvider.GCS:
          return {
            isConfigured: true,
            storageProvider: config.storageProvider,
            projectId: rawConfig.projectId,
            bucket: rawConfig.bucket,
            storageClass: rawConfig.storageClass,
          };

        case StorageProvider.AZURE:
          return {
            isConfigured: true,
            storageProvider: config.storageProvider,
            accountName: rawConfig.accountName,
            containerName: rawConfig.containerName,
            accessTier: rawConfig.accessTier,
            endpoint: rawConfig.endpoint,
          };

        default:
          return {
            isConfigured: true,
            storageProvider: config.storageProvider,
          };
      }
    } catch (error) {
      this.logger.error('Error decrypting storage config:', error);
      return { isConfigured: false };
    }
  }

  /**
   * Get JWT secret
   */
  async getJwtSecret(): Promise<string | null> {
    const config = await this.getSystemConfig();
    return config?.jwtSecret || null;
  }

  /**
   * Get API key salt
   */
  async getApiKeySalt(): Promise<string | null> {
    const config = await this.getSystemConfig();
    return config?.apiKeySalt || null;
  }

  /**
   * Get storage configuration from environment variables (non-sensitive info only)
   */
  getEnvStorageConfig(): EnvStorageConfigResponseDto {
    const storageType = this.configService.get<string>('STORAGE_TYPE');

    if (!storageType) {
      return { isConfigured: false };
    }

    if (storageType === 'local') {
      return {
        isConfigured: true,
        storageProvider: 'local',
        localPath: this.configService.get<string>('LOCAL_STORAGE_PATH') || './uploads',
      };
    }

    if (storageType === 'minio') {
      const endpoint = this.configService.get<string>('MINIO_ENDPOINT');
      const portStr = this.configService.get<string>('MINIO_PORT');
      const port = portStr ? parseInt(portStr, 10) : 9000;
      const bucket = this.configService.get<string>('MINIO_BUCKET');
      const useSSL = this.configService.get<string>('MINIO_USE_SSL') === 'true';
      const accessKey = this.configService.get<string>('MINIO_ACCESS_KEY');
      const secretKey = this.configService.get<string>('MINIO_SECRET_KEY');

      // Check if essential config is present
      if (!endpoint || !accessKey || !secretKey || !bucket) {
        return { isConfigured: false };
      }

      return {
        isConfigured: true,
        storageProvider: 'minio',
        endpoint,
        port,
        bucket,
        useSSL,
      };
    }

    return { isConfigured: false };
  }

  /**
   * Get managed storage type from MANAGED_STORAGE_TYPE environment variable.
   * Defaults to 's3' for S3-compatible services (DigitalOcean Spaces, MinIO, etc.)
   */
  getManagedStorageType(): 'local' | 'minio' | 's3' | 'gcs' | 'azure' {
    const type = this.configService.get<string>('MANAGED_STORAGE_TYPE') || 's3';
    const validTypes = ['local', 'minio', 's3', 'gcs', 'azure'];
    if (!validTypes.includes(type)) {
      this.logger.warn(`Invalid MANAGED_STORAGE_TYPE: ${type}, defaulting to s3`);
      return 's3';
    }
    return type as 'local' | 'minio' | 's3' | 'gcs' | 'azure';
  }

  /**
   * Get managed storage prefix from MANAGED_STORAGE_PREFIX environment variable.
   * Used for workspace isolation in shared buckets.
   */
  getManagedStoragePrefix(): string {
    return this.configService.get<string>('MANAGED_STORAGE_PREFIX') || '';
  }

  /**
   * Get managed storage configuration from MANAGED_STORAGE_* environment variables.
   * Returns S3-compatible config for platform-provided storage.
   */
  getManagedStorageConfig(): S3StorageConfigDto | null {
    const endpoint = this.configService.get<string>('MANAGED_STORAGE_ENDPOINT');
    const region = this.configService.get<string>('MANAGED_STORAGE_REGION');
    const bucket = this.configService.get<string>('MANAGED_STORAGE_BUCKET');
    const accessKey = this.configService.get<string>('MANAGED_STORAGE_ACCESS_KEY');
    const secretKey = this.configService.get<string>('MANAGED_STORAGE_SECRET_KEY');

    // Check if essential config is present
    if (!endpoint || !accessKey || !secretKey || !bucket) {
      this.logger.warn('Managed storage environment variables not fully configured');
      return null;
    }

    return {
      endpoint,
      region: region || 'us-east-1',
      bucket,
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
      forcePathStyle: true, // Most S3-compatible services require this
    };
  }

  /**
   * Get managed email configuration from MANAGED_EMAIL_* environment variables.
   * Returns provider-specific config for platform-provided email.
   */
  getManagedEmailConfig(): { provider: EmailProviderType; config: Record<string, unknown> } | null {
    const provider = this.configService.get<string>('MANAGED_EMAIL_PROVIDER');
    const apiKey = this.configService.get<string>('MANAGED_EMAIL_API_KEY');
    const fromAddress =
      this.configService.get<string>('MANAGED_EMAIL_FROM_ADDRESS') ||
      this.configService.get<string>('MANAGED_EMAIL_FROM');
    const fromName = this.configService.get<string>('MANAGED_EMAIL_FROM_NAME') || 'Platform';

    if (!provider || !apiKey || !fromAddress) {
      this.logger.warn('Managed email environment variables not fully configured');
      return null;
    }

    // Map to the correct provider config
    switch (provider.toLowerCase()) {
      case 'resend':
        return {
          provider: 'resend' as EmailProviderType,
          config: {
            apiKey,
            fromAddress,
            fromName,
          },
        };
      case 'sendgrid':
        return {
          provider: 'sendgrid' as EmailProviderType,
          config: {
            apiKey,
            fromAddress,
            fromName,
          },
        };
      default:
        this.logger.warn(`Unknown managed email provider: ${provider}`);
        return null;
    }
  }

  /**
   * Get managed Redis configuration from MANAGED_REDIS_* environment variables.
   * Returns Redis config for platform-provided shared Redis.
   */
  getManagedRedisConfig(): {
    host: string;
    port: number;
    password?: string;
    keyPrefix: string;
  } | null {
    const host = this.configService.get<string>('MANAGED_REDIS_HOST');
    const port = parseInt(this.configService.get<string>('MANAGED_REDIS_PORT') || '6379', 10);
    const password = this.configService.get<string>('MANAGED_REDIS_PASSWORD');
    const workspaceId = this.configService.get<string>('WORKSPACE_ID') || 'default';

    if (!host) {
      this.logger.warn('Managed Redis environment variables not configured');
      return null;
    }

    return {
      host,
      port,
      password: password || undefined,
      keyPrefix: `workspace:${workspaceId}:cache:`,
    };
  }

  /**
   * Configure storage from environment variables
   */
  async configureStorageFromEnv(): Promise<StorageConfigResponseDto> {
    const status = await this.getSetupStatus();
    if (status.isSetupComplete) {
      throw new BadRequestException('Cannot modify storage configuration after setup is complete');
    }

    const storageType = this.configService.get<string>('STORAGE_TYPE');

    if (!storageType) {
      throw new BadRequestException('STORAGE_TYPE not configured in environment');
    }

    let storageProvider: StorageProvider;
    let config: any;

    if (storageType === 'local') {
      storageProvider = StorageProvider.LOCAL;
      config = {
        localPath: this.configService.get<string>('LOCAL_STORAGE_PATH') || './uploads',
      };
    } else if (storageType === 'minio') {
      storageProvider = StorageProvider.MINIO;
      const endpoint = this.configService.get<string>('MINIO_ENDPOINT');
      const portStr = this.configService.get<string>('MINIO_PORT');
      const port = portStr ? parseInt(portStr, 10) : 9000;
      const bucket = this.configService.get<string>('MINIO_BUCKET');
      const useSSL = this.configService.get<string>('MINIO_USE_SSL') === 'true';
      const accessKey = this.configService.get<string>('MINIO_ACCESS_KEY');
      const secretKey = this.configService.get<string>('MINIO_SECRET_KEY');

      if (!endpoint || !accessKey || !secretKey || !bucket) {
        throw new BadRequestException(
          'MinIO configuration incomplete. Required: MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY, MINIO_BUCKET',
        );
      }

      config = {
        endpoint,
        port,
        bucket,
        useSSL,
        accessKey,
        secretKey,
      };
    } else {
      throw new BadRequestException(`Unsupported STORAGE_TYPE: ${storageType}`);
    }

    // Use existing configureStorage method
    return this.configureStorage({ storageProvider, config });
  }

  /**
   * Get SMTP configuration from environment variables (non-sensitive info only)
   */
  getEnvSmtpConfig(): EnvSmtpConfigResponseDto {
    const smtpHost = this.configService.get<string>('SMTP_HOST');

    if (!smtpHost) {
      return { isConfigured: false };
    }

    const portStr = this.configService.get<string>('SMTP_PORT');
    const port = portStr ? parseInt(portStr, 10) : 587;
    const secure = this.configService.get<string>('SMTP_SECURE') === 'true';
    const user = this.configService.get<string>('SMTP_USER');
    const fromAddress = this.configService.get<string>('EMAIL_FROM_ADDRESS') || user;
    const fromName = this.configService.get<string>('EMAIL_FROM_NAME') || 'Static Asset Platform';

    // Mask the user email for display
    const maskedUser = user ? this.maskEmail(user) : undefined;

    return {
      isConfigured: true,
      host: smtpHost,
      port,
      secure,
      user: maskedUser,
      fromAddress,
      fromName,
    };
  }

  /**
   * Configure SMTP from environment variables
   */
  async configureSmtpFromEnv(): Promise<SmtpConfigResponseDto> {
    const status = await this.getSetupStatus();
    if (status.isSetupComplete) {
      throw new BadRequestException('Cannot modify SMTP configuration after setup is complete');
    }

    const smtpHost = this.configService.get<string>('SMTP_HOST');

    if (!smtpHost) {
      throw new BadRequestException('SMTP_HOST not configured in environment');
    }

    const portStr = this.configService.get<string>('SMTP_PORT');
    const port = portStr ? parseInt(portStr, 10) : 587;
    const secure = this.configService.get<string>('SMTP_SECURE') === 'true';
    const user = this.configService.get<string>('SMTP_USER');
    const password = this.configService.get<string>('SMTP_PASSWORD');
    const fromAddress = this.configService.get<string>('EMAIL_FROM_ADDRESS') || user;
    const fromName = this.configService.get<string>('EMAIL_FROM_NAME') || 'Static Asset Platform';

    if (!user || !password) {
      throw new BadRequestException(
        'SMTP configuration incomplete. Required: SMTP_HOST, SMTP_USER, SMTP_PASSWORD',
      );
    }

    const config = {
      host: smtpHost,
      port,
      secure,
      user,
      password,
      fromAddress,
      fromName,
    };

    return this.configureSmtp({ config });
  }

  /**
   * Configure SMTP with provided configuration
   */
  async configureSmtp(dto: ConfigureSmtpDto): Promise<SmtpConfigResponseDto> {
    const status = await this.getSetupStatus();
    if (status.isSetupComplete) {
      throw new BadRequestException('Cannot modify SMTP configuration after setup is complete');
    }

    try {
      // Validate SMTP configuration
      this.validateSmtpConfig(dto.config);

      // Encrypt sensitive SMTP configuration
      const encryptedConfig = this.encryptData(JSON.stringify(dto.config));

      // Get or create system config
      const config = await this.getSystemConfig();

      if (config) {
        // Update existing config
        await db
          .update(systemConfig)
          .set({
            smtpConfig: encryptedConfig,
            smtpConfigured: true,
            updatedAt: new Date(),
          })
          .where(eq(systemConfig.id, config.id));
      } else {
        // Create new config (should not happen during setup flow, but handle it)
        const jwtSecret = this.generateSecret(64);
        const apiKeySalt = this.generateSecret(32);

        await db.insert(systemConfig).values({
          isSetupComplete: false,
          smtpConfig: encryptedConfig,
          smtpConfigured: true,
          jwtSecret,
          apiKeySalt,
        });
      }

      this.logger.log('SMTP configured successfully');

      return {
        message: 'SMTP configured successfully',
        smtpConfigured: true,
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error('Error configuring SMTP:', error);
      throw new InternalServerErrorException('Failed to configure SMTP');
    }
  }

  /**
   * Test SMTP connection
   */
  async testSmtpConnection(): Promise<TestSmtpResponseDto> {
    try {
      const config = await this.getSystemConfig();

      if (!config || !config.smtpConfig) {
        throw new BadRequestException('SMTP not configured');
      }

      // Decrypt SMTP config
      const smtpConfig = JSON.parse(this.decryptData(config.smtpConfig));

      // Create transporter and test connection
      const transporter = nodemailer.createTransport({
        host: smtpConfig.host,
        port: smtpConfig.port,
        secure: smtpConfig.secure || false,
        auth: {
          user: smtpConfig.user,
          pass: smtpConfig.password,
        },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
      });

      // Verify connection
      await transporter.verify();

      this.logger.log('SMTP connection test passed');

      return {
        success: true,
        message: 'Successfully connected to SMTP server',
      };
    } catch (error) {
      this.logger.error('SMTP connection test failed:', error);
      return {
        success: false,
        message: 'SMTP connection test failed',
        error: error.message,
      };
    }
  }

  /**
   * Get decrypted SMTP configuration
   */
  async getSmtpConfig(): Promise<any> {
    const config = await this.getSystemConfig();
    if (!config || !config.smtpConfig) {
      return null;
    }

    return JSON.parse(this.decryptData(config.smtpConfig));
  }

  /**
   * Validate SMTP configuration
   */
  private validateSmtpConfig(config: any): void {
    if (!config.host || !config.user || !config.password) {
      throw new BadRequestException('host, user, and password are required for SMTP');
    }

    if (
      config.port &&
      (typeof config.port !== 'number' || config.port < 1 || config.port > 65535)
    ) {
      throw new BadRequestException('Invalid port number');
    }
  }

  /**
   * Mask email for display (e.g., "jo***@example.com")
   */
  private maskEmail(email: string): string {
    const [localPart, domain] = email.split('@');
    if (!domain) return email;

    const maskedLocal =
      localPart.length > 2 ? localPart.substring(0, 2) + '***' : localPart + '***';

    return `${maskedLocal}@${domain}`;
  }

  /**
   * Generate cryptographically secure random secret
   */
  private generateSecret(length: number): string {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Encrypt sensitive data
   */
  private encryptData(data: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.ENCRYPTION_ALGORITHM, this.ENCRYPTION_KEY, iv);

    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Combine iv, authTag, and encrypted data
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  /**
   * Decrypt sensitive data
   */
  private decryptData(encryptedData: string): string {
    const [ivHex, authTagHex, encrypted] = encryptedData.split(':');

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(this.ENCRYPTION_ALGORITHM, this.ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Validate storage configuration based on provider type
   */
  private validateStorageConfig(provider: StorageProvider, config: any): void {
    switch (provider) {
      case StorageProvider.LOCAL:
        if (!config.localPath) {
          throw new BadRequestException('localPath is required for local storage');
        }
        break;

      case StorageProvider.MINIO:
        if (!config.endpoint || !config.accessKey || !config.secretKey || !config.bucket) {
          throw new BadRequestException(
            'endpoint, accessKey, secretKey, and bucket are required for MinIO',
          );
        }
        break;

      case StorageProvider.S3:
        if (!config.region || !config.accessKeyId || !config.secretAccessKey || !config.bucket) {
          throw new BadRequestException(
            'region, accessKeyId, secretAccessKey, and bucket are required for S3',
          );
        }
        break;

      case StorageProvider.GCS:
        if (!config.projectId || !config.bucket) {
          throw new BadRequestException('projectId and bucket are required for GCS');
        }
        // Check authentication method - at least one must be provided (or ADC)
        if (
          !config.credentials &&
          !config.keyFilename &&
          !config.useApplicationDefaultCredentials
        ) {
          // Allow no explicit auth for ADC fallback, but warn
          this.logger.warn(
            'GCS: No explicit authentication configured, will use Application Default Credentials',
          );
        }
        // Validate credentials object if provided
        if (config.credentials) {
          if (!config.credentials.client_email || !config.credentials.private_key) {
            throw new BadRequestException('GCS credentials require client_email and private_key');
          }
        }
        break;

      case StorageProvider.AZURE:
        if (!config.accountName || !config.containerName) {
          throw new BadRequestException('accountName and containerName are required for Azure');
        }
        // Check authentication method - at least one must be provided
        const azureAuthMethods = [
          config.accountKey,
          config.connectionString,
          config.useManagedIdentity,
        ].filter(Boolean);
        if (azureAuthMethods.length === 0) {
          throw new BadRequestException(
            'Azure requires authentication: accountKey, connectionString, or useManagedIdentity',
          );
        }
        if (azureAuthMethods.length > 1) {
          throw new BadRequestException(
            'Azure requires only one authentication method: accountKey, connectionString, or useManagedIdentity',
          );
        }
        // Validate managed identity client ID requires managed identity enabled
        if (config.managedIdentityClientId && !config.useManagedIdentity) {
          throw new BadRequestException(
            'managedIdentityClientId requires useManagedIdentity to be true',
          );
        }
        break;

      case StorageProvider.MANAGED:
        // Managed storage uses S3 config format (loaded from MANAGED_STORAGE_* env vars)
        if (!config.region || !config.accessKeyId || !config.secretAccessKey || !config.bucket) {
          throw new BadRequestException(
            'Managed storage configuration is incomplete. Check MANAGED_STORAGE_* environment variables.',
          );
        }
        break;

      default:
        throw new BadRequestException(`Unsupported storage provider: ${provider}`);
    }
  }

  // =============================================================================
  // Email Provider Methods (New - Multi-Provider Support)
  // =============================================================================

  /**
   * Get list of available email providers
   */
  getAvailableEmailProviders(): GetEmailProvidersResponseDto {
    const implementedProviders = getImplementedProviders();

    const providers = Object.values(EMAIL_PROVIDER_METADATA).map((provider) => ({
      ...provider,
      implemented: implementedProviders.includes(provider.id),
    }));

    return { providers };
  }

  /**
   * Configure email provider
   */
  async configureEmail(dto: ConfigureEmailDto): Promise<ConfigureEmailResponseDto> {
    const status = await this.getSetupStatus();
    if (status.isSetupComplete) {
      throw new BadRequestException('Cannot modify email configuration after setup is complete');
    }

    // Validate against feature flags
    const availableOptions = await this.getAvailableOptions();
    const emailProviderFlags: Record<string, boolean> = {
      [EmailProvider.MANAGED]: availableOptions.email.managed,
      [EmailProvider.SMTP]: availableOptions.email.smtp,
      [EmailProvider.SENDGRID]: availableOptions.email.sendgrid,
      [EmailProvider.RESEND]: availableOptions.email.resend,
      // SES, Mailgun, Postmark not controlled by flags for now
      [EmailProvider.SES]: true,
      [EmailProvider.MAILGUN]: true,
      [EmailProvider.POSTMARK]: true,
    };

    if (!emailProviderFlags[dto.provider]) {
      throw new BadRequestException(
        `Email provider '${dto.provider}' is not available. ` +
          'This option is disabled by feature flags.',
      );
    }

    try {
      // Handle MANAGED email - load config from environment variables
      let actualProvider = dto.provider as EmailProviderType;
      let actualConfig = dto.config;

      if (dto.provider === EmailProvider.MANAGED) {
        const managedEmail = this.getManagedEmailConfig();
        if (!managedEmail) {
          throw new BadRequestException(
            'Managed email is not configured. MANAGED_EMAIL_* environment variables are missing.',
          );
        }
        actualProvider = managedEmail.provider;
        actualConfig = managedEmail.config as unknown as typeof dto.config;
      }

      // Validate provider is implemented
      const implementedProviders = getImplementedProviders();
      if (!implementedProviders.includes(actualProvider)) {
        throw new BadRequestException(
          `Email provider '${actualProvider}' is not yet implemented. Available: ${implementedProviders.join(', ')}`,
        );
      }

      // Validate configuration
      this.validateEmailConfig(actualProvider, actualConfig);

      // Encrypt sensitive email configuration
      const encryptedConfig = this.encryptData(JSON.stringify(actualConfig));

      // Get or create system config
      const config = await this.getSystemConfig();

      if (config) {
        // Update existing config
        await db
          .update(systemConfig)
          .set({
            emailProvider: dto.provider,
            emailConfig: encryptedConfig,
            emailConfigured: true,
            updatedAt: new Date(),
          })
          .where(eq(systemConfig.id, config.id));
      } else {
        // Create new config (should not happen during setup flow, but handle it)
        const jwtSecret = this.generateSecret(64);
        const apiKeySalt = this.generateSecret(32);

        await db.insert(systemConfig).values({
          isSetupComplete: false,
          emailProvider: dto.provider,
          emailConfig: encryptedConfig,
          emailConfigured: true,
          jwtSecret,
          apiKeySalt,
        });
      }

      // Configure the email service with the new provider
      this.emailService.configure(
        dto.provider as EmailProviderType,
        dto.config as unknown as Record<string, unknown>,
      );

      this.logger.log(`Email provider configured: ${dto.provider}`);

      return {
        message: 'Email configured successfully',
        provider: dto.provider,
        emailConfigured: true,
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error('Error configuring email:', error);
      throw new InternalServerErrorException('Failed to configure email');
    }
  }

  /**
   * Test email connection
   */
  async testEmailConnection(): Promise<TestEmailResponseDto> {
    try {
      const config = await this.getSystemConfig();

      if (!config || !config.emailConfig || !config.emailProvider) {
        throw new BadRequestException('Email provider not configured');
      }

      // Decrypt email config
      const emailConfig = JSON.parse(this.decryptData(config.emailConfig));

      // Test using the email service
      const result = await this.emailService.testProviderConfig(
        config.emailProvider as EmailProviderType,
        emailConfig,
      );

      if (result.success) {
        this.logger.log(`Email connection test passed for ${config.emailProvider}`);
      } else {
        this.logger.warn(
          `Email connection test failed for ${config.emailProvider}: ${result.error}`,
        );
      }

      return {
        success: result.success,
        message: result.message,
        error: result.error,
        latencyMs: result.latencyMs,
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error('Email connection test failed:', error);
      return {
        success: false,
        message: 'Email connection test failed',
        error: error.message,
      };
    }
  }

  /**
   * Get decrypted email configuration
   */
  async getEmailConfig(): Promise<{ provider: string; config: any } | null> {
    const sysConfig = await this.getSystemConfig();
    if (!sysConfig || !sysConfig.emailConfig || !sysConfig.emailProvider) {
      return null;
    }

    return {
      provider: sysConfig.emailProvider,
      config: JSON.parse(this.decryptData(sysConfig.emailConfig)),
    };
  }

  /**
   * Initialize email service from stored configuration
   * Called on application startup
   */
  async initializeEmailService(): Promise<void> {
    try {
      const emailConfig = await this.getEmailConfig();
      if (emailConfig) {
        this.emailService.configure(emailConfig.provider as EmailProviderType, emailConfig.config);
        this.logger.log(`Email service initialized with provider: ${emailConfig.provider}`);
      } else {
        this.logger.log('No email configuration found, email service not initialized');
      }
    } catch (error) {
      this.logger.error('Failed to initialize email service:', error);
    }
  }

  /**
   * Validate email configuration based on provider type
   */
  private validateEmailConfig(provider: EmailProviderType, config: any): void {
    // Common validation: fromAddress is always required
    if (!config.fromAddress) {
      throw new BadRequestException('fromAddress is required for all email providers');
    }

    switch (provider) {
      case 'smtp':
        if (!config.host) {
          throw new BadRequestException('host is required for SMTP');
        }
        if (!config.port) {
          throw new BadRequestException('port is required for SMTP');
        }
        break;

      case 'sendgrid':
        if (!config.apiKey) {
          throw new BadRequestException('apiKey is required for SendGrid');
        }
        break;

      case 'resend':
        if (!config.apiKey) {
          throw new BadRequestException('apiKey is required for Resend');
        }
        break;

      case 'ses':
        if (!config.region || !config.accessKeyId || !config.secretAccessKey) {
          throw new BadRequestException(
            'region, accessKeyId, and secretAccessKey are required for AWS SES',
          );
        }
        break;

      case 'mailgun':
        if (!config.apiKey || !config.domain) {
          throw new BadRequestException('apiKey and domain are required for Mailgun');
        }
        break;

      case 'postmark':
        if (!config.serverToken) {
          throw new BadRequestException('serverToken is required for Postmark');
        }
        break;

      default:
        throw new BadRequestException(`Unsupported email provider: ${provider}`);
    }
  }

  // =============================================================================
  // Cache Configuration Methods
  // =============================================================================

  /**
   * Default cache configuration
   */
  private readonly DEFAULT_CACHE_CONFIG: CacheConfig = {
    type: 'memory',
    enabled: true,
    defaultTtl: 86400, // 24 hours (content is SHA-keyed/immutable)
    maxSize: 100 * 1024 * 1024, // 100MB
    maxItems: 10000,
    maxFileSize: 10 * 1024 * 1024, // 10MB
  };

  /**
   * Get cache configuration from environment variables
   * Used as fallback when no database config exists
   */
  private getEnvCacheConfig(): CacheConfig {
    const cacheType = this.configService.get<string>('CACHE_TYPE');

    if (cacheType === 'redis') {
      const redisConfig = this.getLocalRedisConfig();
      // Use workspace prefix for cache key isolation in shared Redis (PaaS)
      // Reuses MANAGED_STORAGE_PREFIX since it's the same workspace ID
      const workspacePrefix = this.getManagedStoragePrefix();
      const keyPrefix = workspacePrefix ? `${workspacePrefix}:cache:` : 'storage:cache:';

      return {
        ...this.DEFAULT_CACHE_CONFIG,
        type: 'redis',
        redis: {
          host: redisConfig.host,
          port: redisConfig.port,
          password: redisConfig.password,
          db: 0,
          keyPrefix,
        },
      };
    }

    return this.DEFAULT_CACHE_CONFIG;
  }

  /**
   * Get cache configuration from database
   * Falls back to environment variables, then defaults
   * Uses in-memory caching to avoid DB queries on every request
   */
  async getCacheConfig(): Promise<CacheConfig> {
    // Check if we have a valid cached config
    const now = Date.now();
    if (this.cachedCacheConfig && now - this.cacheConfigLoadedAt < this.CACHE_CONFIG_TTL) {
      return this.cachedCacheConfig;
    }

    try {
      const config = await this.getSystemConfig();

      if (!config || !config.cacheConfig) {
        // No DB config, use environment/defaults
        const envConfig = this.getEnvCacheConfig();
        this.cachedCacheConfig = envConfig;
        this.cacheConfigLoadedAt = now;
        return envConfig;
      }

      // Decrypt and parse the stored config
      const decrypted = this.decryptData(config.cacheConfig);
      const cacheConfig = JSON.parse(decrypted) as CacheConfig;

      // Merge with defaults to ensure all fields exist
      const mergedConfig = {
        ...this.DEFAULT_CACHE_CONFIG,
        ...cacheConfig,
      };

      // Cache the result
      this.cachedCacheConfig = mergedConfig;
      this.cacheConfigLoadedAt = now;

      return mergedConfig;
    } catch (error) {
      this.logger.error('Failed to get cache config:', error);
      const envConfig = this.getEnvCacheConfig();
      this.cachedCacheConfig = envConfig;
      this.cacheConfigLoadedAt = now;
      return envConfig;
    }
  }

  /**
   * Save cache configuration to database
   * Encrypts sensitive data (Redis password)
   */
  async saveCacheConfig(config: CacheConfig): Promise<void> {
    // Encrypt the entire config (includes Redis password if present)
    const encrypted = this.encryptData(JSON.stringify(config));

    // Get or create system config
    const sysConfig = await this.getSystemConfig();

    if (sysConfig) {
      // Update existing config
      await db
        .update(systemConfig)
        .set({
          cacheConfig: encrypted,
          updatedAt: new Date(),
        })
        .where(eq(systemConfig.id, sysConfig.id));
    } else {
      // Create new config (should not happen, but handle it)
      const jwtSecret = this.generateSecret(64);
      const apiKeySalt = this.generateSecret(32);

      await db.insert(systemConfig).values({
        isSetupComplete: false,
        cacheConfig: encrypted,
        jwtSecret,
        apiKeySalt,
      });
    }

    this.logger.log(`Cache config saved: type=${config.type}, enabled=${config.enabled}`);

    // Invalidate the in-memory cache
    this.cachedCacheConfig = null;
    this.cacheConfigLoadedAt = 0;

    // Rewrap storage adapter with new cache config (if storage is already configured)
    await this.rewrapStorageWithCache();
  }

  /**
   * Rewrap the storage adapter with caching layer
   * Called after cache config is saved to apply changes without restart
   *
   * IMPORTANT: Reuses the existing cache adapter from DI when possible to preserve
   * cached data and hit/miss statistics. Only creates a new adapter when the cache
   * type changes (e.g., memory -> redis) or when no adapter exists.
   */
  private async rewrapStorageWithCache(): Promise<void> {
    try {
      let dynamicAdapter = this.dynamicStorageAdapter;

      // Try moduleRef if not injected directly
      if (!dynamicAdapter) {
        dynamicAdapter = this.moduleRef.get<DynamicStorageAdapter>(DYNAMIC_STORAGE_ADAPTER, {
          strict: false,
        });
      }

      if (!dynamicAdapter) {
        this.logger.warn('Cannot rewrap storage - DynamicStorageAdapter not available');
        return;
      }

      // Get current underlying adapter (unwrap if already cached)
      const currentAdapter = dynamicAdapter.getUnderlyingAdapter();
      if (!currentAdapter) {
        this.logger.log('No storage adapter configured yet, skipping cache rewrap');
        return;
      }

      // Get the base adapter and existing cache adapter (unwrap CachingStorageAdapter if present)
      let baseAdapter = currentAdapter;
      let existingCacheAdapter: ICacheAdapter | null = null;
      if (currentAdapter instanceof CachingStorageAdapter) {
        baseAdapter = currentAdapter.getWrappedAdapter();
        existingCacheAdapter = currentAdapter.getCacheAdapter();
        this.logger.log('Unwrapping existing CachingStorageAdapter');
      }

      // Rewrap with new cache config
      const cacheConfig = await this.getCacheConfig();

      this.logger.log(
        `Rewrap check: enabled=${cacheConfig.enabled}, type=${cacheConfig.type}, hasRedis=${!!cacheConfig.redis}`,
      );

      if (cacheConfig.enabled === false) {
        // Caching disabled - use base adapter directly
        this.logger.log('Caching disabled, using base storage adapter');
        dynamicAdapter.setAdapter(baseAdapter);
        return;
      }

      // Determine if we can reuse the existing cache adapter
      const existingType = existingCacheAdapter?.constructor.name;
      const needsNewAdapter =
        !existingCacheAdapter ||
        (cacheConfig.type === 'redis' && existingType !== 'RedisCacheAdapter') ||
        (cacheConfig.type === 'memory' && existingType !== 'MemoryCacheAdapter');

      let cacheAdapterToUse: ICacheAdapter;

      if (needsNewAdapter) {
        // Create a new cache adapter (type changed or no existing adapter)
        const { CacheModule } = await import('../storage/cache/cache.module');
        cacheAdapterToUse = CacheModule.createAdapter(cacheConfig);
        this.logger.log(`Created new ${cacheConfig.type} cache adapter`);
      } else {
        // Reuse existing adapter to preserve cached data and stats
        // existingCacheAdapter is guaranteed non-null here due to needsNewAdapter check
        cacheAdapterToUse = existingCacheAdapter!;
        this.logger.log(
          `Reusing existing ${cacheConfig.type} cache adapter (preserving cache data)`,
        );
      }

      const wrappedAdapter = new CachingStorageAdapter(baseAdapter, cacheAdapterToUse, cacheConfig);
      dynamicAdapter.setAdapter(wrappedAdapter);
    } catch (error) {
      this.logger.error('Failed to rewrap storage with cache:', error);
    }
  }

  /**
   * Check if cache is configured
   */
  async isCacheConfigured(): Promise<boolean> {
    const config = await this.getSystemConfig();
    return !!(config && config.cacheConfig);
  }

  /**
   * Get local Redis config from environment variables
   * Used when user selects "Local Redis (Docker)" in setup wizard
   */
  getLocalRedisConfig(): { host: string; port: number; password?: string; hasPassword: boolean } {
    return {
      host: this.configService.get<string>('REDIS_HOST') || 'redis', // Docker service name
      port: parseInt(this.configService.get<string>('REDIS_PORT') || '6379', 10),
      password: this.configService.get<string>('REDIS_PASSWORD') || undefined,
      hasPassword: !!this.configService.get<string>('REDIS_PASSWORD'),
    };
  }

  /**
   * Get default Redis configuration for the environment
   */
  getDefaultRedisConfig(): { host: string; port: number } {
    return {
      host: this.configService.get<string>('REDIS_HOST') || 'redis',
      port: parseInt(this.configService.get<string>('REDIS_PORT') || '6379', 10),
    };
  }

  // =============================================================================
  // Existing User Adoption Methods (for PaaS multi-workspace support)
  // =============================================================================

  /**
   * Check if an email exists in SuperTokens and/or the workspace database.
   * This is used to determine if a user can be "adopted" as admin for a new workspace.
   */
  async checkEmail(email: string): Promise<{
    existsInAuth: boolean;
    existsInWorkspace: boolean;
    canAdopt: boolean;
    message?: string;
  }> {
    try {
      // Check if email exists in this workspace's database
      const existingUser = await db.select().from(users).where(eq(users.email, email)).limit(1);
      const existsInWorkspace = existingUser.length > 0;

      // Check if email exists in SuperTokens
      let existsInAuth = false;
      try {
        const stUsers = await listUsersByAccountInfo(this.superTokensTenantId, {
          email,
        });
        existsInAuth = stUsers.length > 0;
      } catch {
        // listUsersByAccountInfo may throw if there's an error
        existsInAuth = false;
      }

      // Check if workspace already has an admin
      const adminUsers = await db.select().from(users).where(eq(users.role, 'admin')).limit(1);
      const hasAdmin = adminUsers.length > 0;

      // Determine if this user can be adopted as admin
      // Can adopt if: exists in auth, doesn't exist in workspace, and workspace has no admin
      const canAdopt = existsInAuth && !existsInWorkspace && !hasAdmin;

      let message: string | undefined;
      if (existsInWorkspace) {
        message = 'User already exists in this workspace';
      } else if (hasAdmin) {
        message = 'This workspace already has an admin';
      } else if (existsInAuth && !existsInWorkspace) {
        message = 'Account found. You can sign in to become admin of this workspace.';
      } else if (!existsInAuth) {
        message = 'No existing account found. You can create a new account.';
      }

      return {
        existsInAuth,
        existsInWorkspace,
        canAdopt,
        message,
      };
    } catch (error) {
      this.logger.error('Error checking email:', error);
      throw new InternalServerErrorException('Failed to check email status');
    }
  }

  /**
   * Adopt the current session user as admin for this workspace.
   * No password required since session already proves identity.
   */
  async adoptSessionUser(
    sessionUserId: string,
    sessionEmail: string,
    token?: string,
  ): Promise<{ message: string; userId: string; email: string }> {
    // Validate onboarding token (prevents unauthorized admin creation)
    this.validateOnboardingToken(token);

    // Check if setup is already complete
    const status = await this.getSetupStatus();
    if (status.isSetupComplete) {
      throw new ConflictException('System setup is already complete');
    }

    // Check if admin user already exists in this workspace
    if (status.hasAdminUser) {
      throw new ConflictException('Admin user already exists in this workspace');
    }

    try {
      // Check if user already exists in this workspace
      const existingUser = await db
        .select()
        .from(users)
        .where(eq(users.email, sessionEmail))
        .limit(1);

      if (existingUser.length > 0) {
        throw new ConflictException('User with this email already exists in this workspace');
      }

      // Create admin user in this workspace's database
      // Use the session user ID as the database ID for consistency
      const [newUser] = await db
        .insert(users)
        .values({
          id: sessionUserId,
          email: sessionEmail,
          role: 'admin',
        })
        .returning();

      // Initialize system config if it doesn't exist
      let config = await this.getSystemConfig();
      if (!config) {
        const jwtSecret = this.generateSecret(64);
        const apiKeySalt = this.generateSecret(32);

        [config] = await db
          .insert(systemConfig)
          .values({
            isSetupComplete: false,
            jwtSecret,
            apiKeySalt,
          })
          .returning();
      }

      this.logger.log(`Session user adopted as admin: ${sessionEmail}`);

      return {
        message: 'Account adopted as admin successfully',
        userId: newUser.id,
        email: newUser.email,
      };
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      this.logger.error('Error adopting session user:', error);
      throw new InternalServerErrorException('Failed to adopt session user');
    }
  }

  /**
   * Adopt an existing SuperTokens user as admin for this workspace.
   * The user must already exist in SuperTokens but NOT in this workspace's database.
   * They must provide their password to verify identity.
   */
  async adoptExistingUser(
    email: string,
    password: string,
    token?: string,
  ): Promise<{ message: string; userId: string; email: string }> {
    // Validate onboarding token (prevents unauthorized admin creation)
    this.validateOnboardingToken(token);

    // Check if setup is already complete
    const status = await this.getSetupStatus();
    if (status.isSetupComplete) {
      throw new ConflictException('System setup is already complete');
    }

    // Check if admin user already exists in this workspace
    if (status.hasAdminUser) {
      throw new ConflictException('Admin user already exists in this workspace');
    }

    try {
      // Check if user already exists in this workspace
      const existingUser = await db.select().from(users).where(eq(users.email, email)).limit(1);

      if (existingUser.length > 0) {
        throw new ConflictException('User with this email already exists in this workspace');
      }

      // Verify the user exists in SuperTokens and password is correct by signing in
      const signInResponse = await EmailPassword.signIn(this.superTokensTenantId, email, password);

      if (signInResponse.status === 'WRONG_CREDENTIALS_ERROR') {
        throw new BadRequestException('Invalid email or password');
      }

      if (signInResponse.status !== 'OK') {
        throw new InternalServerErrorException('Failed to verify credentials');
      }

      // Get SuperTokens user IDs
      // - recipeUserId: The actual SuperTokens internal ID (use this for mapping lookups)
      // - user.id: May already be the mapped external ID if a mapping exists
      const recipeUserId = signInResponse.recipeUserId.getAsString();
      const primaryUserId = signInResponse.user.id;

      this.logger.log(
        `Sign-in successful. Recipe user ID: ${recipeUserId}, Primary user ID: ${primaryUserId}`,
      );

      // Check if there's an existing user ID mapping
      // Use 'ANY' because SuperTokens might already be returning the mapped external ID
      let userIdToUse: string;
      let mappingExists = false;
      try {
        const mapping = await getUserIdMapping({
          userId: recipeUserId,
          userIdType: 'ANY',
        });
        if (mapping.status === 'OK') {
          // Mapping exists - use the external user ID
          // If recipeUserId IS the external ID, externalUserId will be set
          // If recipeUserId is the SuperTokens ID, externalUserId will be set
          userIdToUse = mapping.externalUserId;
          mappingExists = true;
          this.logger.log(
            `Found existing user ID mapping: ${mapping.superTokensUserId} -> ${userIdToUse}`,
          );
        } else {
          // No mapping exists - the recipeUserId IS the SuperTokens ID, use it directly
          // (since session.getUserId() will return this ID when no mapping exists)
          userIdToUse = recipeUserId;
          this.logger.log(`No existing mapping, will use recipe user ID directly: ${userIdToUse}`);
        }
      } catch (err) {
        // Error checking mapping - use the recipeUserId directly
        userIdToUse = recipeUserId;
        this.logger.log(
          `Error checking mapping (${err}), will use recipe user ID directly: ${userIdToUse}`,
        );
      }

      // User verified! Create them as admin in this workspace's database
      // Use the determined user ID (either from existing mapping or new UUID)
      const [newUser] = await db
        .insert(users)
        .values({
          id: userIdToUse,
          email,
          role: 'admin',
        })
        .returning();

      // Only create user ID mapping if one doesn't already exist
      if (!mappingExists) {
        try {
          await createUserIdMapping({
            superTokensUserId: recipeUserId,
            externalUserId: newUser.id,
          });
          this.logger.log(`Created user ID mapping: ${recipeUserId} -> ${newUser.id}`);
        } catch (mappingError) {
          // Mapping creation failed - this shouldn't happen since we checked above
          this.logger.warn(`Failed to create user ID mapping: ${mappingError}`);
        }
      } else {
        this.logger.log(`Using existing user ID mapping, no new mapping needed`);
      }

      // Initialize system config if it doesn't exist
      let config = await this.getSystemConfig();
      if (!config) {
        const jwtSecret = this.generateSecret(64);
        const apiKeySalt = this.generateSecret(32);

        [config] = await db
          .insert(systemConfig)
          .values({
            isSetupComplete: false,
            jwtSecret,
            apiKeySalt,
          })
          .returning();
      }

      this.logger.log(`Existing user adopted as admin: ${email}`);

      return {
        message: 'Existing account adopted as admin successfully',
        userId: newUser.id,
        email: newUser.email,
      };
    } catch (error) {
      if (error instanceof ConflictException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error('Error adopting existing user:', error);
      throw new InternalServerErrorException('Failed to adopt existing user');
    }
  }

  // =============================================
  // Registration Settings
  // =============================================

  /**
   * Check if the registration feature flag is enabled (circuit breaker).
   * When disabled, ALL registration is blocked including invites.
   */
  async isRegistrationFeatureEnabled(): Promise<boolean> {
    return this.featureFlagsService.isEnabled('ENABLE_USER_REGISTRATION');
  }

  /**
   * Get registration settings including feature flag and database setting.
   */
  async getRegistrationSettings(): Promise<{
    registrationEnabled: boolean;
    allowPublicSignups: boolean;
  }> {
    const config = await this.getSystemConfig();
    return {
      registrationEnabled: await this.isRegistrationFeatureEnabled(),
      allowPublicSignups: config?.allowPublicSignups ?? false,
    };
  }

  /**
   * Update the allowPublicSignups setting (admin-controlled).
   * When false, only invited users can sign up.
   * When true, anyone can sign up (if registration feature flag is also enabled).
   */
  async updateAllowPublicSignups(value: boolean): Promise<{
    message: string;
    allowPublicSignups: boolean;
  }> {
    const config = await this.getSystemConfig();
    if (!config) {
      throw new BadRequestException('System not initialized');
    }

    await db
      .update(systemConfig)
      .set({
        allowPublicSignups: value,
        updatedAt: new Date(),
      })
      .where(eq(systemConfig.id, config.id));

    this.logger.log(`Updated allowPublicSignups to ${value}`);

    return {
      message: `Public signups ${value ? 'enabled' : 'disabled'} successfully`,
      allowPublicSignups: value,
    };
  }

  /**
   * Check if public signup is allowed (both feature flag AND database setting).
   * This is the check to use for the signup endpoint.
   */
  async canPublicSignup(): Promise<boolean> {
    if (!(await this.isRegistrationFeatureEnabled())) {
      return false;
    }
    const config = await this.getSystemConfig();
    return config?.allowPublicSignups ?? false;
  }
}
