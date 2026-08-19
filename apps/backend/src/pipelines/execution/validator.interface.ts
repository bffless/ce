import { PipelineContext } from './pipeline-context.interface';
import { ValidatorType, ValidatorConfig, AuthRequiredConfig, RateLimitConfig } from '../types';

// Re-export config types for validators to use
export type { AuthRequiredConfig as AuthRequiredValidatorConfig };
export type { RateLimitConfig as RateLimitValidatorConfig };

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
