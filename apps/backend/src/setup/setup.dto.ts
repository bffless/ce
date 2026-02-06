import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsEmail,
  IsNotEmpty,
  MinLength,
  IsEnum,
  IsObject,
  IsOptional,
  IsNumber,
  IsBoolean,
} from 'class-validator';

export enum StorageProvider {
  LOCAL = 'local',
  MINIO = 'minio',
  S3 = 's3',
  GCS = 'gcs',
  AZURE = 'azure',
  MANAGED = 'managed', // Platform-provided storage (uses MANAGED_STORAGE_* env vars)
}

// Storage Configuration Classes
export class LocalStorageConfigDto {
  @ApiProperty({ description: 'Local storage path', example: './uploads' })
  @IsString()
  @IsNotEmpty()
  localPath: string;
}

export class MinIOStorageConfigDto {
  @ApiProperty({ description: 'MinIO endpoint URL', example: 'localhost:9000' })
  @IsString()
  @IsNotEmpty()
  endpoint: string;

  @ApiProperty({ description: 'MinIO access key' })
  @IsString()
  @IsNotEmpty()
  accessKey: string;

  @ApiProperty({ description: 'MinIO secret key' })
  @IsString()
  @IsNotEmpty()
  secretKey: string;

  @ApiProperty({ description: 'MinIO bucket name', example: 'assets' })
  @IsString()
  @IsNotEmpty()
  bucket: string;

  @ApiPropertyOptional({ description: 'Use SSL', default: false })
  @IsBoolean()
  @IsOptional()
  useSSL?: boolean;

  @ApiPropertyOptional({ description: 'MinIO port', example: 9000 })
  @IsNumber()
  @IsOptional()
  port?: number;
}

export class S3StorageConfigDto {
  @ApiProperty({ description: 'AWS region', example: 'us-east-1' })
  @IsString()
  @IsNotEmpty()
  region: string;

  @ApiProperty({ description: 'AWS access key ID' })
  @IsString()
  @IsNotEmpty()
  accessKeyId: string;

  @ApiProperty({ description: 'AWS secret access key' })
  @IsString()
  @IsNotEmpty()
  secretAccessKey: string;

  @ApiProperty({ description: 'S3 bucket name' })
  @IsString()
  @IsNotEmpty()
  bucket: string;

  @ApiPropertyOptional({
    description: 'Custom endpoint for S3-compatible services',
    example: 'https://nyc3.digitaloceanspaces.com',
  })
  @IsOptional()
  @IsString()
  endpoint?: string;

  @ApiPropertyOptional({
    description: 'Force path-style URLs (required for some S3-compatible services)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  forcePathStyle?: boolean;

  @ApiPropertyOptional({
    description: 'Presigned URL expiration in seconds',
    default: 3600,
  })
  @IsOptional()
  @IsNumber()
  presignedUrlExpiration?: number;
}

export class GcsCredentialsDto {
  @ApiProperty({ description: 'Service account email' })
  @IsString()
  @IsNotEmpty()
  client_email: string;

  @ApiProperty({ description: 'Service account private key' })
  @IsString()
  @IsNotEmpty()
  private_key: string;

  @ApiPropertyOptional({ description: 'Project ID (optional, uses parent config)' })
  @IsOptional()
  @IsString()
  project_id?: string;
}

export class GCSStorageConfigDto {
  @ApiProperty({ description: 'GCS project ID', example: 'my-project-123' })
  @IsString()
  @IsNotEmpty()
  projectId: string;

  @ApiProperty({ description: 'GCS bucket name', example: 'my-deployment-assets' })
  @IsString()
  @IsNotEmpty()
  bucket: string;

  @ApiPropertyOptional({ description: 'Path to service account key file' })
  @IsOptional()
  @IsString()
  keyFilename?: string;

  @ApiPropertyOptional({ description: 'Service account credentials object' })
  @IsOptional()
  @IsObject()
  credentials?: GcsCredentialsDto;

  @ApiPropertyOptional({
    description: 'Storage class for new objects',
    enum: ['STANDARD', 'NEARLINE', 'COLDLINE', 'ARCHIVE'],
    default: 'STANDARD',
  })
  @IsOptional()
  @IsString()
  storageClass?: 'STANDARD' | 'NEARLINE' | 'COLDLINE' | 'ARCHIVE';

  @ApiPropertyOptional({
    description: 'Signed URL expiration in seconds',
    default: 3600,
  })
  @IsOptional()
  @IsNumber()
  signedUrlExpiration?: number;

  @ApiPropertyOptional({
    description: 'Use Application Default Credentials',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  useApplicationDefaultCredentials?: boolean;
}

export class AzureStorageConfigDto {
  @ApiProperty({ description: 'Azure storage account name', example: 'mystorageaccount' })
  @IsString()
  @IsNotEmpty()
  accountName: string;

  @ApiProperty({ description: 'Azure container name', example: 'deployments' })
  @IsString()
  @IsNotEmpty()
  containerName: string;

  @ApiPropertyOptional({ description: 'Storage account access key' })
  @IsOptional()
  @IsString()
  accountKey?: string;

  @ApiPropertyOptional({ description: 'Azure Storage connection string' })
  @IsOptional()
  @IsString()
  connectionString?: string;

  @ApiPropertyOptional({
    description: 'Use Azure Managed Identity',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  useManagedIdentity?: boolean;

  @ApiPropertyOptional({ description: 'Client ID for user-assigned managed identity' })
  @IsOptional()
  @IsString()
  managedIdentityClientId?: string;

  @ApiPropertyOptional({
    description: 'Blob access tier',
    enum: ['Hot', 'Cool', 'Archive'],
    default: 'Hot',
  })
  @IsOptional()
  @IsString()
  accessTier?: 'Hot' | 'Cool' | 'Archive';

  @ApiPropertyOptional({
    description: 'SAS URL expiration in seconds',
    default: 3600,
  })
  @IsOptional()
  @IsNumber()
  sasUrlExpiration?: number;

  @ApiPropertyOptional({ description: 'Custom endpoint URL (for Azure Government, China, etc.)' })
  @IsOptional()
  @IsString()
  endpoint?: string;
}

// Main DTOs
export class InitializeSystemDto {
  @ApiProperty({ description: 'Admin user email', example: 'admin@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    description: 'Admin user password (min 8 characters)',
    example: 'SecurePassword123!',
  })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @IsNotEmpty()
  password: string;

  @ApiPropertyOptional({
    description: 'Onboarding token for secure workspace setup (required in platform mode)',
  })
  @IsString()
  @IsOptional()
  token?: string;
}

export class ConfigureStorageDto {
  @ApiProperty({
    description: 'Storage provider type',
    enum: StorageProvider,
    example: StorageProvider.MINIO,
  })
  @IsEnum(StorageProvider)
  @IsNotEmpty()
  storageProvider: StorageProvider;

  @ApiPropertyOptional({
    description: 'Storage configuration (structure depends on provider)',
    type: 'object',
  })
  @IsObject()
  @IsNotEmpty()
  config:
    | LocalStorageConfigDto
    | MinIOStorageConfigDto
    | S3StorageConfigDto
    | GCSStorageConfigDto
    | AzureStorageConfigDto;
}

export class CompleteSetupDto {
  @ApiProperty({ description: 'Confirm setup completion', example: true })
  @IsBoolean()
  @IsNotEmpty()
  confirm: boolean;
}

// Response DTOs
export class SetupStatusResponseDto {
  @ApiProperty({ description: 'Whether system setup is complete' })
  isSetupComplete: boolean;

  @ApiPropertyOptional({ description: 'Current storage provider, if configured' })
  storageProvider?: string;

  @ApiPropertyOptional({ description: 'Whether admin user exists' })
  hasAdminUser?: boolean;

  @ApiPropertyOptional({ description: 'Whether email is configured (any provider)' })
  emailConfigured?: boolean;

  @ApiPropertyOptional({ description: 'Current email provider, if configured' })
  emailProvider?: string;

  @ApiPropertyOptional({ description: 'Whether SMTP is configured (legacy, use emailConfigured)' })
  smtpConfigured?: boolean;
}

export class InitializeResponseDto {
  @ApiProperty({ description: 'Success message' })
  message: string;

  @ApiProperty({ description: 'Created user ID' })
  userId: string;

  @ApiProperty({ description: 'User email' })
  email: string;
}

export class StorageConfigResponseDto {
  @ApiProperty({ description: 'Success message' })
  message: string;

  @ApiProperty({ description: 'Configured storage provider' })
  storageProvider: string;
}

export class TestStorageResponseDto {
  @ApiProperty({ description: 'Whether storage connection is successful' })
  success: boolean;

  @ApiProperty({ description: 'Status message' })
  message: string;

  @ApiPropertyOptional({ description: 'Error details if connection failed' })
  error?: string;
}

export class CompleteSetupResponseDto {
  @ApiProperty({ description: 'Success message' })
  message: string;

  @ApiProperty({ description: 'Setup completion status' })
  isSetupComplete: boolean;
}

export class EnvStorageConfigResponseDto {
  @ApiProperty({ description: 'Whether storage is configured in environment' })
  isConfigured: boolean;

  @ApiPropertyOptional({ description: 'Storage provider from environment' })
  storageProvider?: string;

  @ApiPropertyOptional({ description: 'Storage endpoint (hostname)' })
  endpoint?: string;

  @ApiPropertyOptional({ description: 'Storage port' })
  port?: number;

  @ApiPropertyOptional({ description: 'Bucket name' })
  bucket?: string;

  @ApiPropertyOptional({ description: 'Whether SSL is enabled' })
  useSSL?: boolean;

  @ApiPropertyOptional({ description: 'Local storage path (for local provider)' })
  localPath?: string;
}

/**
 * Response DTO for current storage configuration (non-sensitive info only)
 * This returns the active storage config from the database, not from env vars
 */
export class CurrentStorageConfigResponseDto {
  @ApiProperty({ description: 'Whether storage is configured' })
  isConfigured: boolean;

  @ApiPropertyOptional({ description: 'Storage provider type' })
  storageProvider?: string;

  @ApiPropertyOptional({ description: 'Storage endpoint (for S3-compatible, MinIO)' })
  endpoint?: string;

  @ApiPropertyOptional({ description: 'Storage port (for MinIO)' })
  port?: number;

  @ApiPropertyOptional({ description: 'Bucket name' })
  bucket?: string;

  @ApiPropertyOptional({ description: 'Container name (for Azure)' })
  containerName?: string;

  @ApiPropertyOptional({ description: 'AWS/Cloud region' })
  region?: string;

  @ApiPropertyOptional({ description: 'Whether SSL is enabled' })
  useSSL?: boolean;

  @ApiPropertyOptional({ description: 'Local storage path (for local provider)' })
  localPath?: string;

  @ApiPropertyOptional({ description: 'Project ID (for GCS)' })
  projectId?: string;

  @ApiPropertyOptional({ description: 'Storage account name (for Azure)' })
  accountName?: string;

  @ApiPropertyOptional({ description: 'Whether this is an S3-compatible service (has custom endpoint)' })
  isS3Compatible?: boolean;

  @ApiPropertyOptional({ description: 'Storage class (for GCS)' })
  storageClass?: string;

  @ApiPropertyOptional({ description: 'Access tier (for Azure)' })
  accessTier?: string;
}

// SMTP Configuration DTOs
export class SmtpConfigDto {
  @ApiProperty({ description: 'SMTP server host', example: 'smtp.gmail.com' })
  @IsString()
  @IsNotEmpty()
  host: string;

  @ApiProperty({ description: 'SMTP server port', example: 587 })
  @IsNumber()
  @IsNotEmpty()
  port: number;

  @ApiPropertyOptional({ description: 'Use SSL/TLS', default: false })
  @IsBoolean()
  @IsOptional()
  secure?: boolean;

  @ApiProperty({ description: 'SMTP username/email' })
  @IsString()
  @IsNotEmpty()
  user: string;

  @ApiProperty({ description: 'SMTP password or app password' })
  @IsString()
  @IsNotEmpty()
  password: string;

  @ApiPropertyOptional({ description: 'From email address', example: 'noreply@example.com' })
  @IsEmail()
  @IsOptional()
  fromAddress?: string;

  @ApiPropertyOptional({ description: 'From display name', example: 'Static Asset Platform' })
  @IsString()
  @IsOptional()
  fromName?: string;
}

export class ConfigureSmtpDto {
  @ApiProperty({ description: 'SMTP configuration', type: SmtpConfigDto })
  @IsObject()
  @IsNotEmpty()
  config: SmtpConfigDto;
}

export class SmtpConfigResponseDto {
  @ApiProperty({ description: 'Success message' })
  message: string;

  @ApiProperty({ description: 'Whether SMTP is now configured' })
  smtpConfigured: boolean;
}

export class TestSmtpResponseDto {
  @ApiProperty({ description: 'Whether SMTP connection is successful' })
  success: boolean;

  @ApiProperty({ description: 'Status message' })
  message: string;

  @ApiPropertyOptional({ description: 'Error details if connection failed' })
  error?: string;
}

export class EnvSmtpConfigResponseDto {
  @ApiProperty({ description: 'Whether SMTP is configured in environment' })
  isConfigured: boolean;

  @ApiPropertyOptional({ description: 'SMTP host' })
  host?: string;

  @ApiPropertyOptional({ description: 'SMTP port' })
  port?: number;

  @ApiPropertyOptional({ description: 'Whether SSL/TLS is enabled' })
  secure?: boolean;

  @ApiPropertyOptional({ description: 'SMTP user (masked)' })
  user?: string;

  @ApiPropertyOptional({ description: 'From email address' })
  fromAddress?: string;

  @ApiPropertyOptional({ description: 'From display name' })
  fromName?: string;
}

// =============================================================================
// Email Provider DTOs (New - Multi-Provider Support)
// =============================================================================

export enum EmailProvider {
  SMTP = 'smtp',
  SENDGRID = 'sendgrid',
  SES = 'ses',
  MAILGUN = 'mailgun',
  RESEND = 'resend',
  POSTMARK = 'postmark',
  MANAGED = 'managed', // Platform-provided email (uses MANAGED_EMAIL_* env vars)
}

// Provider-specific configuration DTOs
export class SmtpEmailConfigDto {
  @ApiProperty({ description: 'SMTP server host', example: 'smtp.gmail.com' })
  @IsString()
  @IsNotEmpty()
  host: string;

  @ApiProperty({ description: 'SMTP server port', example: 587 })
  @IsNumber()
  @IsNotEmpty()
  port: number;

  @ApiPropertyOptional({ description: 'Use SSL/TLS', default: false })
  @IsBoolean()
  @IsOptional()
  secure?: boolean;

  @ApiPropertyOptional({ description: 'SMTP username/email' })
  @IsString()
  @IsOptional()
  user?: string;

  @ApiPropertyOptional({ description: 'SMTP password or app password' })
  @IsString()
  @IsOptional()
  password?: string;

  @ApiProperty({ description: 'From email address', example: 'noreply@example.com' })
  @IsEmail()
  @IsNotEmpty()
  fromAddress: string;

  @ApiPropertyOptional({
    description: 'From display name',
    example: 'Static Asset Platform',
  })
  @IsString()
  @IsOptional()
  fromName?: string;
}

export class SendGridEmailConfigDto {
  @ApiProperty({ description: 'SendGrid API key', example: 'SG.xxxxxx' })
  @IsString()
  @IsNotEmpty()
  apiKey: string;

  @ApiProperty({ description: 'From email address', example: 'noreply@example.com' })
  @IsEmail()
  @IsNotEmpty()
  fromAddress: string;

  @ApiPropertyOptional({
    description: 'From display name',
    example: 'Static Asset Platform',
  })
  @IsString()
  @IsOptional()
  fromName?: string;
}

export class ResendEmailConfigDto {
  @ApiProperty({ description: 'Resend API key', example: 're_xxxxxx' })
  @IsString()
  @IsNotEmpty()
  apiKey: string;

  @ApiProperty({ description: 'From email address', example: 'noreply@example.com' })
  @IsEmail()
  @IsNotEmpty()
  fromAddress: string;

  @ApiPropertyOptional({
    description: 'From display name',
    example: 'Static Asset Platform',
  })
  @IsString()
  @IsOptional()
  fromName?: string;
}

export class AwsSesEmailConfigDto {
  @ApiProperty({ description: 'AWS region', example: 'us-east-1' })
  @IsString()
  @IsNotEmpty()
  region: string;

  @ApiProperty({ description: 'AWS access key ID' })
  @IsString()
  @IsNotEmpty()
  accessKeyId: string;

  @ApiProperty({ description: 'AWS secret access key' })
  @IsString()
  @IsNotEmpty()
  secretAccessKey: string;

  @ApiProperty({ description: 'From email address', example: 'noreply@example.com' })
  @IsEmail()
  @IsNotEmpty()
  fromAddress: string;

  @ApiPropertyOptional({
    description: 'From display name',
    example: 'Static Asset Platform',
  })
  @IsString()
  @IsOptional()
  fromName?: string;
}

export class MailgunEmailConfigDto {
  @ApiProperty({ description: 'Mailgun API key' })
  @IsString()
  @IsNotEmpty()
  apiKey: string;

  @ApiProperty({ description: 'Mailgun domain', example: 'mg.example.com' })
  @IsString()
  @IsNotEmpty()
  domain: string;

  @ApiPropertyOptional({ description: 'Mailgun region', enum: ['us', 'eu'], default: 'us' })
  @IsString()
  @IsOptional()
  region?: 'us' | 'eu';

  @ApiProperty({ description: 'From email address', example: 'noreply@example.com' })
  @IsEmail()
  @IsNotEmpty()
  fromAddress: string;

  @ApiPropertyOptional({
    description: 'From display name',
    example: 'Static Asset Platform',
  })
  @IsString()
  @IsOptional()
  fromName?: string;
}

export class PostmarkEmailConfigDto {
  @ApiProperty({ description: 'Postmark server token' })
  @IsString()
  @IsNotEmpty()
  serverToken: string;

  @ApiProperty({ description: 'From email address', example: 'noreply@example.com' })
  @IsEmail()
  @IsNotEmpty()
  fromAddress: string;

  @ApiPropertyOptional({
    description: 'From display name',
    example: 'Static Asset Platform',
  })
  @IsString()
  @IsOptional()
  fromName?: string;
}

// Main Email Configuration DTO
export class ConfigureEmailDto {
  @ApiProperty({
    description: 'Email provider type',
    enum: EmailProvider,
    example: EmailProvider.SENDGRID,
  })
  @IsEnum(EmailProvider)
  @IsNotEmpty()
  provider: EmailProvider;

  @ApiProperty({
    description: 'Provider-specific configuration (structure depends on provider)',
    type: 'object',
  })
  @IsObject()
  @IsNotEmpty()
  config:
    | SmtpEmailConfigDto
    | SendGridEmailConfigDto
    | ResendEmailConfigDto
    | AwsSesEmailConfigDto
    | MailgunEmailConfigDto
    | PostmarkEmailConfigDto;
}

// Email Provider Response DTOs
export class EmailProviderInfoDto {
  @ApiProperty({ description: 'Provider ID', example: 'sendgrid' })
  id: string;

  @ApiProperty({ description: 'Provider display name', example: 'SendGrid' })
  name: string;

  @ApiProperty({
    description: 'Provider description',
    example: 'Twilio SendGrid email API',
  })
  description: string;

  @ApiProperty({
    description: 'Whether provider requires network ports (SMTP)',
    example: false,
  })
  requiresPorts: boolean;

  @ApiProperty({ description: 'Required configuration fields', type: [String] })
  fields: string[];

  @ApiPropertyOptional({ description: 'Documentation URL' })
  docsUrl?: string;

  @ApiPropertyOptional({ description: 'Warning message for the provider' })
  warning?: string;

  @ApiPropertyOptional({ description: 'Whether this provider is recommended' })
  recommended?: boolean;

  @ApiPropertyOptional({ description: 'Whether this provider is implemented' })
  implemented?: boolean;
}

export class GetEmailProvidersResponseDto {
  @ApiProperty({ description: 'List of available email providers', type: [EmailProviderInfoDto] })
  providers: EmailProviderInfoDto[];
}

export class ConfigureEmailResponseDto {
  @ApiProperty({ description: 'Success message' })
  message: string;

  @ApiProperty({ description: 'Configured email provider' })
  provider: string;

  @ApiProperty({ description: 'Whether email is now configured' })
  emailConfigured: boolean;
}

export class TestEmailResponseDto {
  @ApiProperty({ description: 'Whether email connection is successful' })
  success: boolean;

  @ApiProperty({ description: 'Status message' })
  message: string;

  @ApiPropertyOptional({ description: 'Error details if connection failed' })
  error?: string;

  @ApiPropertyOptional({ description: 'Connection latency in milliseconds' })
  latencyMs?: number;
}

// =============================================================================
// Service Constraints DTOs (Optional Services)
// =============================================================================

export class ServiceConstraintDto {
  @ApiProperty({ description: 'Whether the service is enabled' })
  enabled: boolean;

  @ApiProperty({
    description: 'Reason why the service is disabled, null if enabled',
    nullable: true,
  })
  reason: string | null;
}

export class ServiceConstraintsResponseDto {
  @ApiProperty({ description: 'MinIO service constraints', type: ServiceConstraintDto })
  minio: ServiceConstraintDto;

  @ApiProperty({ description: 'Redis service constraints', type: ServiceConstraintDto })
  redis: ServiceConstraintDto;
}

// =============================================================================
// Existing User Adoption DTOs (for PaaS multi-workspace support)
// =============================================================================

export class CheckEmailDto {
  @ApiProperty({ description: 'Email to check', example: 'admin@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;
}

export class CheckEmailResponseDto {
  @ApiProperty({ description: 'Whether the email exists in the authentication system' })
  existsInAuth: boolean;

  @ApiProperty({ description: 'Whether the email exists in this workspace database' })
  existsInWorkspace: boolean;

  @ApiProperty({ description: 'Whether this user can be adopted as admin for this workspace' })
  canAdopt: boolean;

  @ApiPropertyOptional({ description: 'Message explaining the status' })
  message?: string;
}

export class AdoptExistingUserDto {
  @ApiProperty({ description: 'User email', example: 'admin@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ description: 'User password (to verify identity)' })
  @IsString()
  @MinLength(8)
  @IsNotEmpty()
  password: string;

  @ApiPropertyOptional({
    description: 'Onboarding token for secure workspace setup (required in platform mode)',
  })
  @IsString()
  @IsOptional()
  token?: string;
}

export class AdoptExistingUserResponseDto {
  @ApiProperty({ description: 'Success message' })
  message: string;

  @ApiProperty({ description: 'User ID in this workspace' })
  userId: string;

  @ApiProperty({ description: 'User email' })
  email: string;
}

// Request DTO for adopting current session user as admin
export class AdoptSessionUserDto {
  @ApiPropertyOptional({
    description: 'Onboarding token for secure workspace setup (required in platform mode)',
  })
  @IsString()
  @IsOptional()
  token?: string;
}

// Response for adopting current session user as admin (no password required)
export class AdoptSessionUserResponseDto {
  @ApiProperty({ description: 'Success message' })
  message: string;

  @ApiProperty({ description: 'User ID in this workspace' })
  userId: string;

  @ApiProperty({ description: 'User email' })
  email: string;
}

// =============================================================================
// Available Options DTOs (for feature-flag-based option filtering)
// =============================================================================

export class StorageOptionsDto {
  @ApiProperty({ description: 'Whether managed storage is available' })
  managed: boolean;

  @ApiProperty({ description: 'Whether S3 BYOB is available' })
  s3: boolean;

  @ApiProperty({ description: 'Whether GCS BYOB is available' })
  gcs: boolean;

  @ApiProperty({ description: 'Whether Azure BYOB is available' })
  azure: boolean;

  @ApiProperty({ description: 'Whether local filesystem storage is available' })
  local: boolean;

  @ApiProperty({ description: 'Whether MinIO storage is available' })
  minio: boolean;
}

export class CacheOptionsDto {
  @ApiProperty({ description: 'Whether LRU in-memory cache is available' })
  lru: boolean;

  @ApiProperty({ description: 'Whether managed Redis is available' })
  managedRedis: boolean;

  @ApiProperty({ description: 'Whether local Docker Redis is available' })
  localRedis: boolean;

  @ApiProperty({ description: 'Whether external Redis is available' })
  externalRedis: boolean;

  @ApiProperty({ description: 'Whether to skip cache step entirely' })
  skipStep: boolean;

  @ApiProperty({ description: 'Default cache type when skipping' })
  defaultType: string;
}

export class EmailOptionsDto {
  @ApiProperty({ description: 'Whether managed email is available' })
  managed: boolean;

  @ApiProperty({ description: 'Whether SMTP is available' })
  smtp: boolean;

  @ApiProperty({ description: 'Whether SendGrid is available' })
  sendgrid: boolean;

  @ApiProperty({ description: 'Whether Resend is available' })
  resend: boolean;

  @ApiProperty({ description: 'Whether skipping email is allowed' })
  skipAllowed: boolean;

  @ApiProperty({ description: 'Whether to skip email step entirely' })
  skipStep: boolean;

  @ApiProperty({ description: 'Default email type when skipping' })
  defaultType: string;
}

export class UIOptionsDto {
  @ApiProperty({ description: 'Show .env optimization hints on setup completion' })
  enableEnvOptimizationHints: boolean;

  @ApiProperty({ description: 'Show settings can be updated later note' })
  enableSettingsUpdateNote: boolean;
}

export class AvailableOptionsResponseDto {
  @ApiProperty({ description: 'Available storage options', type: StorageOptionsDto })
  storage: StorageOptionsDto;

  @ApiProperty({ description: 'Available cache options', type: CacheOptionsDto })
  cache: CacheOptionsDto;

  @ApiProperty({ description: 'Available email options', type: EmailOptionsDto })
  email: EmailOptionsDto;

  @ApiProperty({ description: 'UI display options', type: UIOptionsDto })
  ui: UIOptionsDto;
}

// Registration Settings DTOs
export class RegistrationSettingsResponseDto {
  @ApiProperty({
    description: 'Whether the registration feature flag is enabled (circuit breaker)',
    example: true,
  })
  registrationEnabled: boolean;

  @ApiProperty({
    description: 'Whether public signups are allowed (admin-controlled, invite-only when false)',
    example: false,
  })
  allowPublicSignups: boolean;
}

export class UpdateAllowPublicSignupsDto {
  @ApiProperty({
    description: 'Whether to allow public signups (false = invite-only)',
    example: false,
  })
  @IsBoolean()
  allowPublicSignups: boolean;
}

export class UpdateAllowPublicSignupsResponseDto {
  @ApiProperty({ description: 'Success message' })
  message: string;

  @ApiProperty({ description: 'The updated value' })
  allowPublicSignups: boolean;
}
