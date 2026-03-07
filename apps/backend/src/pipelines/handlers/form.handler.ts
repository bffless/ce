import { Injectable, Logger } from '@nestjs/common';
import { StepHandler, FormHandlerConfig } from '../execution/step-handler.interface';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { PipelineContext, StepResult } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../../db/schema';
import { ConfigurationError, ValidationError } from '../errors';

/**
 * Form Handler
 *
 * Parses and validates form data from request input.
 * Supports field type validation, coercion, and honeypot spam detection.
 */
@Injectable()
export class FormHandler implements StepHandler<FormHandlerConfig> {
  readonly type = 'form_handler' as const;
  private readonly logger = new Logger(FormHandler.name);

  constructor(private readonly registry: StepHandlerRegistry) {
    this.registry.register(this);
  }

  validateConfig(config: FormHandlerConfig): void {
    if (!config.fields || Object.keys(config.fields).length === 0) {
      throw new ConfigurationError('At least one field is required', 'form_handler');
    }

    // Validate each field definition
    for (const [fieldName, fieldConfig] of Object.entries(config.fields)) {
      if (!fieldConfig.type) {
        throw new ConfigurationError(
          `Field '${fieldName}' must have a type`,
          'form_handler',
        );
      }

      const validTypes = ['string', 'number', 'email', 'boolean'];
      if (!validTypes.includes(fieldConfig.type)) {
        throw new ConfigurationError(
          `Field '${fieldName}' has invalid type '${fieldConfig.type}'. Valid types: ${validTypes.join(', ')}`,
          'form_handler',
        );
      }
    }
  }

  async execute(context: PipelineContext, step: PipelineStep): Promise<StepResult> {
    const config = step.config as FormHandlerConfig;
    const stepName = step.name || 'form_handler';

    this.logger.debug(`Executing form handler for step '${stepName}'`);

    const input = context.input;
    const errors: Record<string, string> = {};
    const validatedData: Record<string, unknown> = {};

    // Check honeypot field (spam detection)
    if (config.honeypotField) {
      const honeypotValue = input[config.honeypotField];
      if (honeypotValue !== undefined && honeypotValue !== null && honeypotValue !== '') {
        this.logger.warn(`Honeypot field '${config.honeypotField}' was filled - likely spam`);
        return {
          success: false,
          error: {
            code: 'SPAM_DETECTED',
            message: 'Request rejected',
            details: { honeypot: true },
          },
        };
      }
    }

    // Validate and coerce each field
    for (const [fieldName, fieldConfig] of Object.entries(config.fields)) {
      const rawValue = input[fieldName];

      // Check required
      if (fieldConfig.required && (rawValue === undefined || rawValue === null || rawValue === '')) {
        errors[fieldName] = `${fieldName} is required`;
        continue;
      }

      // Skip validation for optional empty fields
      if (rawValue === undefined || rawValue === null || rawValue === '') {
        validatedData[fieldName] = null;
        continue;
      }

      // Validate and coerce based on type
      try {
        const coercedValue = this.coerceAndValidate(fieldName, rawValue, fieldConfig);
        validatedData[fieldName] = coercedValue;
      } catch (error) {
        errors[fieldName] = error instanceof Error ? error.message : String(error);
      }
    }

    // Return validation errors if any
    if (Object.keys(errors).length > 0) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Form validation failed',
          details: { errors },
        },
      };
    }

    this.logger.debug(`Form validation successful for step '${stepName}'`);

    return {
      success: true,
      output: validatedData,
    };
  }

  private coerceAndValidate(
    fieldName: string,
    value: unknown,
    config: FormHandlerConfig['fields'][string],
  ): unknown {
    const { type, min, max, pattern } = config;

    switch (type) {
      case 'string': {
        const strValue = String(value);

        // Check pattern
        if (pattern) {
          const regex = new RegExp(pattern);
          if (!regex.test(strValue)) {
            throw new Error(`${fieldName} does not match required pattern`);
          }
        }

        // Check length constraints
        if (min !== undefined && strValue.length < min) {
          throw new Error(`${fieldName} must be at least ${min} characters`);
        }
        if (max !== undefined && strValue.length > max) {
          throw new Error(`${fieldName} must be at most ${max} characters`);
        }

        return strValue;
      }

      case 'number': {
        const numValue = typeof value === 'number' ? value : parseFloat(String(value));

        if (isNaN(numValue)) {
          throw new Error(`${fieldName} must be a valid number`);
        }

        // Check range constraints
        if (min !== undefined && numValue < min) {
          throw new Error(`${fieldName} must be at least ${min}`);
        }
        if (max !== undefined && numValue > max) {
          throw new Error(`${fieldName} must be at most ${max}`);
        }

        return numValue;
      }

      case 'email': {
        const emailValue = String(value).trim().toLowerCase();

        // Basic email validation
        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailPattern.test(emailValue)) {
          throw new Error(`${fieldName} must be a valid email address`);
        }

        // Check custom pattern if provided
        if (pattern) {
          const regex = new RegExp(pattern);
          if (!regex.test(emailValue)) {
            throw new Error(`${fieldName} does not match required pattern`);
          }
        }

        // Check length constraints
        if (min !== undefined && emailValue.length < min) {
          throw new Error(`${fieldName} must be at least ${min} characters`);
        }
        if (max !== undefined && emailValue.length > max) {
          throw new Error(`${fieldName} must be at most ${max} characters`);
        }

        return emailValue;
      }

      case 'boolean': {
        // Handle various boolean representations
        if (typeof value === 'boolean') {
          return value;
        }

        const strValue = String(value).toLowerCase().trim();
        if (['true', '1', 'yes', 'on'].includes(strValue)) {
          return true;
        }
        if (['false', '0', 'no', 'off'].includes(strValue)) {
          return false;
        }

        throw new Error(`${fieldName} must be a valid boolean`);
      }

      default:
        throw new Error(`Unknown field type: ${type}`);
    }
  }
}
