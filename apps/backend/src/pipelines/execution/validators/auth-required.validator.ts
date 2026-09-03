import { Injectable, Logger } from '@nestjs/common';
import { Validator, AuthRequiredValidatorConfig } from '../validator.interface';
import { ValidatorRegistry } from '../validator.registry';
import { PipelineContext } from '../pipeline-context.interface';
import { ValidatorConfig, SCOPE_PATTERN } from '../../types';
import { AuthenticationRequiredError, AuthorizationError } from '../../errors';
import { ConfigurationError } from '../../errors';

/**
 * Auth Required Validator
 *
 * Validates that the request has an authenticated user.
 * Optionally validates that the user has one of the required roles.
 *
 * App tokens add a second, independent gate: identity says *who* is acting,
 * `requiredScopes` says *what this credential was delegated*. Only a token is
 * subject to it — a session, a custom-domain cookie or an API key passes every
 * scope check — so effective permission for a token is the member's own
 * permissions ∩ the token's scopes, and a token never elevates.
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
      throw new ConfigurationError('auth_required validator: roles must be an array of strings');
    }

    // Validate each role is a string
    if (config.roles) {
      for (const role of config.roles) {
        if (typeof role !== 'string') {
          throw new ConfigurationError('auth_required validator: each role must be a string');
        }
      }
    }

    if (config.requiredScopes !== undefined) {
      if (!Array.isArray(config.requiredScopes)) {
        throw new ConfigurationError(
          'auth_required validator: requiredScopes must be an array of strings',
        );
      }
      for (const scope of config.requiredScopes) {
        if (typeof scope !== 'string' || !SCOPE_PATTERN.test(scope)) {
          throw new ConfigurationError(
            `auth_required validator: each requiredScope must match namespace:verb (got ${JSON.stringify(scope)})`,
          );
        }
      }
    }
  }

  async validate(context: PipelineContext, validatorConfig: ValidatorConfig): Promise<void> {
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
        throw new AuthorizationError(`Access denied. Required roles: ${config.roles.join(', ')}`);
      }

      // Check if user's role matches any of the required roles
      const hasRequiredRole = config.roles.some(
        (requiredRole) => requiredRole.toLowerCase() === userRole.toLowerCase(),
      );

      if (!hasRequiredRole) {
        this.logger.debug(
          `User role '${userRole}' does not match required roles: ${config.roles.join(', ')}`,
        );
        throw new AuthorizationError(`Access denied. Required roles: ${config.roles.join(', ')}`);
      }

      this.logger.debug(`User role '${userRole}' matches required roles`);
    }

    // App tokens only from here on: a token is bound to one project and carries scopes.
    if (context.user.credential === 'app_token') {
      if (context.user.tokenProjectId && context.user.tokenProjectId !== context.projectId) {
        this.logger.debug('App token is bound to another project');
        throw new AuthorizationError('This token is bound to another project', {
          code: 'token_project_mismatch',
        });
      }

      const required = config.requiredScopes ?? [];
      if (required.length > 0) {
        const granted = context.user.scopes ?? [];
        const missing = required.filter((scope) => !granted.includes(scope));
        if (missing.length > 0) {
          this.logger.debug(`App token is missing scopes: ${missing.join(', ')}`);
          throw new AuthorizationError(`insufficient_scope: missing ${missing.join(', ')}`, {
            code: 'insufficient_scope',
            missingScopes: missing,
          });
        }
      }
    }

    this.logger.debug('Authentication validation passed');
  }
}
