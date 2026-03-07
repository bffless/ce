import { PipelineContext } from './pipeline-context.interface';
import { ValidatorType, ValidatorConfig } from '../../db/schema';

/**
 * Interface that all pipeline validators must implement
 */
export interface Validator<TConfig = unknown> {
  /**
   * The validator type this implements
   */
  readonly type: ValidatorType;

  /**
   * Validate the validator configuration
   * @throws ConfigurationError if config is invalid
   */
  validateConfig(config: TConfig): void | Promise<void>;

  /**
   * Execute validation
   * @param context Pipeline context
   * @param config Validator configuration
   * @throws ValidationError, AuthenticationRequiredError, RateLimitError on failure
   */
  validate(context: PipelineContext, config: ValidatorConfig): Promise<void>;
}

/**
 * Configuration for auth_required validator
 */
export interface AuthRequiredValidatorConfig {
  /**
   * Required roles (any match allows access)
   */
  roles?: string[];

  /**
   * Allow API key authentication
   */
  allowApiKey?: boolean;
}

/**
 * Configuration for rate_limit validator
 */
export interface RateLimitValidatorConfig {
  /**
   * Maximum requests allowed
   */
  limit: number;

  /**
   * Time window in seconds
   */
  windowSeconds: number;

  /**
   * Key to use for rate limiting: 'ip' | 'user' | 'ip+user'
   */
  keyBy?: 'ip' | 'user' | 'ip+user';
}
