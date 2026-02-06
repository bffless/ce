import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  BadRequestException,
  UnauthorizedException,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { SessionContainer } from 'supertokens-node/recipe/session';
import { SetupService } from './setup.service';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthService } from '../auth/auth.service';
import {
  CompleteSetupDto,
  CompleteSetupResponseDto,
  ConfigureStorageDto,
  ConfigureSmtpDto,
  ConfigureEmailDto,
  ConfigureEmailResponseDto,
  CurrentStorageConfigResponseDto,
  EnvStorageConfigResponseDto,
  EnvSmtpConfigResponseDto,
  GetEmailProvidersResponseDto,
  InitializeResponseDto,
  InitializeSystemDto,
  SetupStatusResponseDto,
  SmtpConfigResponseDto,
  StorageConfigResponseDto,
  TestEmailResponseDto,
  TestSmtpResponseDto,
  TestStorageResponseDto,
  ServiceConstraintsResponseDto,
  CheckEmailDto,
  CheckEmailResponseDto,
  AdoptExistingUserDto,
  AdoptExistingUserResponseDto,
  AdoptSessionUserDto,
  AdoptSessionUserResponseDto,
  AvailableOptionsResponseDto,
  RegistrationSettingsResponseDto,
  UpdateAllowPublicSignupsDto,
  UpdateAllowPublicSignupsResponseDto,
} from './setup.dto';
import {
  CacheConfigDto,
  CacheConfigResponseDto,
  TestRedisConnectionDto,
  TestRedisConnectionResponseDto,
  RedisDefaultsResponseDto,
} from './dto/cache-config.dto';
import { RedisCacheAdapter } from '../storage/cache/redis-cache.adapter';

@ApiTags('Setup')
@Controller('api/setup')
export class SetupController {
  private readonly logger = new Logger(SetupController.name);

  constructor(
    private readonly setupService: SetupService,
    private readonly authService: AuthService,
  ) {}

  @Get('status')
  @ApiOperation({
    summary: 'Check setup status',
    description:
      'Check if system setup is complete. This endpoint is public and requires no authentication.',
  })
  @ApiResponse({
    status: 200,
    description: 'Setup status retrieved successfully',
    type: SetupStatusResponseDto,
  })
  async getStatus(): Promise<SetupStatusResponseDto> {
    return this.setupService.getSetupStatus();
  }

  @Get('constraints')
  @ApiOperation({
    summary: 'Get service constraints',
    description:
      'Get constraints for optional services (MinIO, Redis) based on ENABLE_* environment variables. ' +
      'Services with enabled=false cannot be selected during setup.',
  })
  @ApiResponse({
    status: 200,
    description: 'Service constraints retrieved successfully',
    type: ServiceConstraintsResponseDto,
  })
  getConstraints(): ServiceConstraintsResponseDto {
    return this.setupService.getServiceConstraints();
  }

  @Get('available-options')
  @ApiOperation({
    summary: 'Get available options based on feature flags',
    description:
      'Returns available options for storage, cache, and email based on feature flags. ' +
      'Used by setup wizard and admin settings to filter available options.',
  })
  @ApiResponse({
    status: 200,
    description: 'Available options retrieved successfully',
    type: AvailableOptionsResponseDto,
  })
  async getAvailableOptions(): Promise<AvailableOptionsResponseDto> {
    return this.setupService.getAvailableOptions();
  }

  @Post('initialize')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Initialize system',
    description:
      'Create the first admin user and initialize system configuration. This endpoint is public but can only be called once.',
  })
  @ApiResponse({
    status: 201,
    description: 'System initialized successfully',
    type: InitializeResponseDto,
  })
  @ApiResponse({
    status: 409,
    description: 'System already initialized or admin user already exists',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input data',
  })
  async initialize(@Body() dto: InitializeSystemDto): Promise<InitializeResponseDto> {
    return this.setupService.initialize(dto);
  }

  @Post('check-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Check if email exists',
    description:
      'Check if an email exists in the authentication system and/or this workspace. ' +
      'Used to determine if a user can be adopted as admin for this workspace.',
  })
  @ApiResponse({
    status: 200,
    description: 'Email check result',
    type: CheckEmailResponseDto,
  })
  async checkEmail(@Body() dto: CheckEmailDto): Promise<CheckEmailResponseDto> {
    return this.setupService.checkEmail(dto.email);
  }

  @Post('adopt-existing-user')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Adopt existing user as admin',
    description:
      'Allow an existing SuperTokens user to become admin of this workspace. ' +
      'The user must exist in SuperTokens but not in this workspace. Password is required to verify identity.',
  })
  @ApiResponse({
    status: 201,
    description: 'User adopted as admin successfully',
    type: AdoptExistingUserResponseDto,
  })
  @ApiResponse({
    status: 409,
    description: 'System already initialized or admin user already exists',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid credentials or user cannot be adopted',
  })
  async adoptExistingUser(@Body() dto: AdoptExistingUserDto): Promise<AdoptExistingUserResponseDto> {
    return this.setupService.adoptExistingUser(dto.email, dto.password, dto.token);
  }

  @Post('adopt-session-user')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(SessionAuthGuard)
  @ApiOperation({
    summary: 'Adopt current session user as admin',
    description:
      'Allow the currently logged-in user to become admin of this workspace. ' +
      'Requires an active session. No password needed since session proves identity.',
  })
  @ApiResponse({
    status: 201,
    description: 'Session user adopted as admin successfully',
    type: AdoptSessionUserResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'No active session',
  })
  @ApiResponse({
    status: 409,
    description: 'System already initialized or admin user already exists',
  })
  async adoptSessionUser(
    @Req() req: Request & { session?: SessionContainer },
    @Body() dto: AdoptSessionUserDto,
  ): Promise<AdoptSessionUserResponseDto> {
    if (!req.session) {
      throw new UnauthorizedException('No active session');
    }

    const userId = req.session.getUserId();

    // Get user email from auth service
    const user = await this.authService.getUserById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return this.setupService.adoptSessionUser(userId, user.email, dto.token);
  }

  @Post('storage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Configure storage backend',
    description:
      'Configure the storage provider (Local, MinIO, S3, GCS, or Azure). Can only be done before setup is complete.',
  })
  @ApiResponse({
    status: 200,
    description: 'Storage configured successfully',
    type: StorageConfigResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid storage configuration or setup already complete',
  })
  async configureStorage(@Body() dto: ConfigureStorageDto): Promise<StorageConfigResponseDto> {
    return this.setupService.configureStorage(dto);
  }

  @Post('test-storage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Test storage connection',
    description: 'Test the configured storage backend connection and validate credentials.',
  })
  @ApiResponse({
    status: 200,
    description: 'Storage connection test result',
    type: TestStorageResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Storage not configured',
  })
  async testStorage(): Promise<TestStorageResponseDto> {
    return this.setupService.testStorageConnection();
  }

  @Get('storage/env-config')
  @ApiOperation({
    summary: 'Get storage configuration from environment',
    description:
      'Returns the storage configuration detected from environment variables (without sensitive data like keys).',
  })
  @ApiResponse({
    status: 200,
    description: 'Environment storage configuration',
    type: EnvStorageConfigResponseDto,
  })
  getEnvStorageConfig(): EnvStorageConfigResponseDto {
    return this.setupService.getEnvStorageConfig();
  }

  @Get('storage/current')
  @ApiOperation({
    summary: 'Get current storage configuration details',
    description:
      'Returns the current storage configuration from the database (without sensitive data like keys). Shows bucket, region, endpoint, etc.',
  })
  @ApiResponse({
    status: 200,
    description: 'Current storage configuration (non-sensitive)',
    type: CurrentStorageConfigResponseDto,
  })
  async getCurrentStorageConfig(): Promise<CurrentStorageConfigResponseDto> {
    return this.setupService.getCurrentStorageConfigDetails();
  }

  @Post('storage/from-env')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Configure storage from environment variables',
    description:
      'Configure storage using values from environment variables (.env file). Simplifies setup when MinIO is pre-configured.',
  })
  @ApiResponse({
    status: 200,
    description: 'Storage configured from environment',
    type: StorageConfigResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Environment variables not configured or setup already complete',
  })
  async configureStorageFromEnv(): Promise<StorageConfigResponseDto> {
    return this.setupService.configureStorageFromEnv();
  }

  @Get('smtp/env-config')
  @ApiOperation({
    summary: 'Get SMTP configuration from environment',
    description:
      'Returns the SMTP configuration detected from environment variables (without sensitive data like passwords).',
  })
  @ApiResponse({
    status: 200,
    description: 'Environment SMTP configuration',
    type: EnvSmtpConfigResponseDto,
  })
  getEnvSmtpConfig(): EnvSmtpConfigResponseDto {
    return this.setupService.getEnvSmtpConfig();
  }

  @Post('smtp/from-env')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Configure SMTP from environment variables',
    description:
      'Configure SMTP using values from environment variables (.env file). Simplifies setup when SMTP is pre-configured.',
  })
  @ApiResponse({
    status: 200,
    description: 'SMTP configured from environment',
    type: SmtpConfigResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Environment variables not configured or setup already complete',
  })
  async configureSmtpFromEnv(): Promise<SmtpConfigResponseDto> {
    return this.setupService.configureSmtpFromEnv();
  }

  @Post('smtp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Configure SMTP',
    description:
      'Configure SMTP settings for email delivery. Can only be done before setup is complete.',
  })
  @ApiResponse({
    status: 200,
    description: 'SMTP configured successfully',
    type: SmtpConfigResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid SMTP configuration or setup already complete',
  })
  async configureSmtp(@Body() dto: ConfigureSmtpDto): Promise<SmtpConfigResponseDto> {
    return this.setupService.configureSmtp(dto);
  }

  @Post('test-smtp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Test SMTP connection',
    description: 'Test the configured SMTP connection and validate credentials.',
  })
  @ApiResponse({
    status: 200,
    description: 'SMTP connection test result',
    type: TestSmtpResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'SMTP not configured',
  })
  async testSmtp(): Promise<TestSmtpResponseDto> {
    return this.setupService.testSmtpConnection();
  }

  // =============================================================================
  // Email Provider Endpoints (New - Multi-Provider Support)
  // =============================================================================

  @Get('email-providers')
  @ApiOperation({
    summary: 'Get available email providers',
    description:
      'Returns a list of available email providers with their configuration requirements.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of available email providers',
    type: GetEmailProvidersResponseDto,
  })
  getEmailProviders(): GetEmailProvidersResponseDto {
    return this.setupService.getAvailableEmailProviders();
  }

  @Post('email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Configure email provider',
    description:
      'Configure an email provider (SMTP, SendGrid, Resend, etc.). Can only be done before setup is complete.',
  })
  @ApiResponse({
    status: 200,
    description: 'Email configured successfully',
    type: ConfigureEmailResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid email configuration or setup already complete',
  })
  async configureEmail(@Body() dto: ConfigureEmailDto): Promise<ConfigureEmailResponseDto> {
    return this.setupService.configureEmail(dto);
  }

  @Post('test-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Test email connection',
    description: 'Test the configured email provider connection and validate credentials.',
  })
  @ApiResponse({
    status: 200,
    description: 'Email connection test result',
    type: TestEmailResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Email provider not configured',
  })
  async testEmail(): Promise<TestEmailResponseDto> {
    return this.setupService.testEmailConnection();
  }

  @Post('complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Complete setup',
    description:
      'Mark the setup as complete. Requires admin user and storage to be configured. After this, setup cannot be modified.',
  })
  @ApiResponse({
    status: 200,
    description: 'Setup completed successfully',
    type: CompleteSetupResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Prerequisites not met (admin user or storage not configured)',
  })
  @ApiResponse({
    status: 409,
    description: 'Setup already complete',
  })
  async completeSetup(@Body() dto: CompleteSetupDto): Promise<CompleteSetupResponseDto> {
    return this.setupService.completeSetup(dto);
  }

  // =============================================================================
  // Cache Configuration Endpoints
  // =============================================================================

  @Get('cache')
  @ApiOperation({ summary: 'Get current cache configuration' })
  @ApiResponse({ status: 200, type: CacheConfigResponseDto })
  async getCacheConfig(): Promise<CacheConfigResponseDto> {
    const config = await this.setupService.getCacheConfig();
    const isConfigured = await this.setupService.isCacheConfigured();

    // Determine redisSource: use stored value, or fall back to detection for legacy configs
    let redisSource: 'local' | 'external' | 'managed' | undefined;
    if (config.type === 'redis') {
      if (config.redisSource) {
        // Use the stored redisSource value
        redisSource = config.redisSource;
      } else if (config.redis) {
        // Legacy detection for configs saved before redisSource was added
        const managedConfig = this.setupService.getManagedRedisConfig();
        if (managedConfig && config.redis.host === managedConfig.host) {
          redisSource = 'managed';
        } else if (config.redis.host === 'redis') {
          redisSource = 'local';
        } else {
          redisSource = 'external';
        }
      }
    }

    // Return config with password masked
    return {
      enabled: config.enabled ?? true,
      type: config.type ?? 'memory',
      redisSource,
      defaultTtl: config.defaultTtl,
      maxSizeMb: config.maxSize ? Math.round(config.maxSize / (1024 * 1024)) : 100,
      maxFileSizeMb: config.maxFileSize ? Math.round(config.maxFileSize / (1024 * 1024)) : 10,
      redisHost: config.redis?.host,
      redisPort: config.redis?.port,
      isConfigured,
    };
  }

  @Post('cache')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Configure caching' })
  @ApiResponse({ status: 200, description: 'Cache configured successfully' })
  @ApiResponse({ status: 400, description: 'Invalid configuration or connection failed' })
  async configureCache(
    @Body() dto: CacheConfigDto,
  ): Promise<{ success: boolean; message: string }> {
    this.logger.log(`Configuring cache: type=${dto.type}, enabled=${dto.enabled}`);

    // If Redis is selected, resolve the connection details
    if (dto.type === 'redis') {
      // Check if trying to use Docker Redis when it's disabled
      const wantsDockerRedis = dto.redisSource === 'local';
      const constraints = this.setupService.getServiceConstraints();

      if (wantsDockerRedis && !constraints.redis.enabled) {
        throw new BadRequestException(
          'Docker Redis is not available. ENABLE_REDIS=false is set in your .env file. ' +
            'Either select memory caching, configure an external Redis server, or update your .env file and restart Docker.',
        );
      }

      // For managed Redis (PaaS), use platform-provided config with workspace isolation
      if (dto.redisSource === 'managed') {
        const managedConfig = this.setupService.getManagedRedisConfig();
        if (!managedConfig) {
          throw new BadRequestException(
            'Managed Redis is not available. MANAGED_REDIS_HOST environment variable is not configured.',
          );
        }
        dto.redis = {
          host: managedConfig.host,
          port: managedConfig.port,
          password: managedConfig.password,
          db: dto.redis?.db ?? 0,
          keyPrefix: managedConfig.keyPrefix, // Workspace isolation prefix
        };
      }

      // For local Redis, use Docker settings including password from env
      if (dto.redisSource === 'local') {
        const localConfig = this.setupService.getLocalRedisConfig();
        dto.redis = {
          host: localConfig.host,
          port: localConfig.port,
          password: localConfig.password, // Use password from REDIS_PASSWORD env var
          db: dto.redis?.db ?? 0,
        };
      }

      // Validate Redis config exists for external
      if (dto.redisSource === 'external' && !dto.redis?.host) {
        throw new BadRequestException('Redis host is required for external Redis');
      }

      // Test the connection before saving
      if (dto.redis) {
        const testResult = await this.testRedisConnectionInternal(dto.redis);
        if (!testResult.success) {
          throw new BadRequestException(`Redis connection failed: ${testResult.error}`);
        }
      }
    }

    // Save the configuration (include redisSource for proper retrieval later)
    await this.setupService.saveCacheConfig({
      enabled: dto.enabled,
      type: dto.type,
      redisSource: dto.type === 'redis' ? dto.redisSource : undefined,
      defaultTtl: dto.defaultTtl,
      maxSize: dto.maxSizeMb ? dto.maxSizeMb * 1024 * 1024 : undefined,
      maxFileSize: dto.maxFileSizeMb ? dto.maxFileSizeMb * 1024 * 1024 : undefined,
      redis: dto.redis,
    });

    return {
      success: true,
      message:
        dto.type === 'redis'
          ? `Cache configured with ${dto.redisSource} Redis`
          : 'Cache configured with in-memory LRU',
    };
  }

  @Post('cache/test-connection')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Test Redis connection without saving' })
  @ApiResponse({
    status: 200,
    description: 'Connection test result',
    type: TestRedisConnectionResponseDto,
  })
  async testRedisConnection(
    @Body() dto: TestRedisConnectionDto,
  ): Promise<TestRedisConnectionResponseDto> {
    // If useManagedConfig is set, get full config from managed Redis env vars
    if (dto.useManagedConfig) {
      const managedConfig = this.setupService.getManagedRedisConfig();
      if (!managedConfig) {
        return {
          success: false,
          error: 'Managed Redis is not configured. MANAGED_REDIS_HOST environment variable is not set.',
        };
      }
      dto.host = managedConfig.host;
      dto.port = managedConfig.port;
      dto.password = managedConfig.password;
      this.logger.debug(`Using managed Redis config from env (host=${managedConfig.host})`);
    }
    // If useLocalPassword is set, get password from environment
    else if (dto.useLocalPassword) {
      const localConfig = this.setupService.getLocalRedisConfig();
      dto.password = localConfig.password;
      this.logger.debug(`Using local Redis password from env (hasPassword=${localConfig.hasPassword})`);
    }
    return this.testRedisConnectionInternal(dto);
  }

  @Get('cache/defaults')
  @ApiOperation({ summary: 'Get default Redis configuration for current environment' })
  @ApiResponse({ status: 200, type: RedisDefaultsResponseDto })
  async getRedisDefaults(): Promise<RedisDefaultsResponseDto & { hasPassword: boolean }> {
    const localConfig = this.setupService.getLocalRedisConfig();
    const isDocker = localConfig.host === 'redis';
    return {
      host: localConfig.host,
      port: localConfig.port,
      isDocker,
      hasPassword: localConfig.hasPassword,
    };
  }

  // =============================================================================
  // Registration Settings Endpoints
  // =============================================================================

  @Get('registration')
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({
    summary: 'Get registration settings',
    description:
      'Get current registration settings including feature flag status and public signup setting. Admin only.',
  })
  @ApiResponse({
    status: 200,
    description: 'Registration settings retrieved successfully',
    type: RegistrationSettingsResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin role required' })
  async getRegistrationSettings(): Promise<RegistrationSettingsResponseDto> {
    return this.setupService.getRegistrationSettings();
  }

  @Post('registration/allow-public-signups')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({
    summary: 'Update public signup setting',
    description:
      'Enable or disable public signups. When disabled, only invited users can register. Admin only.',
  })
  @ApiResponse({
    status: 200,
    description: 'Setting updated successfully',
    type: UpdateAllowPublicSignupsResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid request or system not initialized' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin role required' })
  async updateAllowPublicSignups(
    @Body() dto: UpdateAllowPublicSignupsDto,
  ): Promise<UpdateAllowPublicSignupsResponseDto> {
    return this.setupService.updateAllowPublicSignups(dto.allowPublicSignups);
  }

  // =============================================================================
  // Private Helpers
  // =============================================================================

  private async testRedisConnectionInternal(
    config: TestRedisConnectionDto,
  ): Promise<TestRedisConnectionResponseDto> {
    const startTime = Date.now();

    try {
      const testAdapter = new RedisCacheAdapter({
        type: 'redis',
        redis: {
          host: config.host,
          port: config.port,
          password: config.password,
          db: config.db ?? 0,
        },
      });

      const connected = await testAdapter.testConnection();
      const latencyMs = Date.now() - startTime;

      // Clean up test connection
      await testAdapter.onModuleDestroy();

      if (connected) {
        this.logger.log(
          `Redis connection test successful: ${config.host}:${config.port} (${latencyMs}ms)`,
        );
        return { success: true, latencyMs };
      } else {
        return { success: false, error: 'Connection test failed' };
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Redis connection test failed: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }
}
