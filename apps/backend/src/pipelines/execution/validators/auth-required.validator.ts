import { Injectable, Logger } from '@nestjs/common';
import { Validator, AuthRequiredValidatorConfig } from '../validator.interface';
import { ValidatorRegistry } from '../validator.registry';
import { PipelineContext } from '../pipeline-context.interface';
import { ValidatorConfig } from '../../../db/schema';
import { AuthenticationRequiredError, AuthorizationError } from '../../errors';
import { ConfigurationError } from '../../errors';

/**
 * Auth Required Validator
 *
 * Validates that the request has an authenticated user.
 * Optionally validates that the user has one of the required roles.
 */
@Injectable()
export class AuthRequiredValidator implements Validator<AuthRequiredValidatorConfig> {
  readonly type = 'auth_required' as const;
  private readonly logger = new Logger(AuthRequiredValidator.name);

  constructor(private readonly registry: ValidatorRegistry) {
    this.registry.register(this);
  }

  validateConfig(config: AuthRequiredValidatorConfig): void {
    // roles is optional, but if provided must be an array
    if (config.roles !== undefined && !Array.isArray(config.roles)) {
      throw new ConfigurationError(
        'auth_required validator: roles must be an array of strings',
      );
    }

    // Validate each role is a string
    if (config.roles) {
      for (const role of config.roles) {
        if (typeof role !== 'string') {
          throw new ConfigurationError(
            'auth_required validator: each role must be a string',
          );
        }
      }
    }
  }

  async validate(
    context: PipelineContext,
    validatorConfig: ValidatorConfig,
  ): Promise<void> {
    // Type narrowing via discriminated union
    if (validatorConfig.type !== 'auth_required') {
      throw new ConfigurationError(
        `AuthRequiredValidator received wrong config type: ${validatorConfig.type}`,
      );
    }
    const config = validatorConfig.config;

    this.logger.debug('Validating authentication requirement');

    // Check if user is authenticated
    if (!context.user) {
      this.logger.debug('No user in context - authentication required');
      throw new AuthenticationRequiredError('Authentication required to access this pipeline');
    }

    // Check role requirements if specified
    if (config.roles && config.roles.length > 0) {
      const userRole = context.user.role;

      if (!userRole) {
        this.logger.debug('User has no role but roles are required');
        throw new AuthorizationError(
          `Access denied. Required roles: ${config.roles.join(', ')}`,
        );
      }

      // Check if user's role matches any of the required roles
      const hasRequiredRole = config.roles.some(
        (requiredRole) => requiredRole.toLowerCase() === userRole.toLowerCase(),
      );

      if (!hasRequiredRole) {
        this.logger.debug(
          `User role '${userRole}' does not match required roles: ${config.roles.join(', ')}`,
        );
        throw new AuthorizationError(
          `Access denied. Required roles: ${config.roles.join(', ')}`,
        );
      }

      this.logger.debug(`User role '${userRole}' matches required roles`);
    }

    this.logger.debug('Authentication validation passed');
  }
}
