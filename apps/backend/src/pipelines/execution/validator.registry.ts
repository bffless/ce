import { Injectable, Logger } from '@nestjs/common';
import { Validator } from './validator.interface';
import { ValidatorType } from '../../db/schema';
import { ConfigurationError } from '../errors';

/**
 * Registry for pipeline validators
 * Validators register themselves on startup
 */
@Injectable()
export class ValidatorRegistry {
  private readonly logger = new Logger(ValidatorRegistry.name);
  private readonly validators = new Map<ValidatorType, Validator>();

  /**
   * Register a validator for a specific type
   */
  register(validator: Validator): void {
    if (this.validators.has(validator.type)) {
      this.logger.warn(`Validator for type '${validator.type}' is being overwritten`);
    }
    this.validators.set(validator.type, validator);
    this.logger.log(`Registered validator for type: ${validator.type}`);
  }

  /**
   * Get a validator by type
   * @throws ConfigurationError if validator is not registered
   */
  get(type: ValidatorType): Validator {
    const validator = this.validators.get(type);
    if (!validator) {
      throw new ConfigurationError(`Validator type '${type}' is not registered`);
    }
    return validator;
  }

  /**
   * Check if a validator is registered
   */
  has(type: ValidatorType): boolean {
    return this.validators.has(type);
  }

  /**
   * Get all registered validator types
   */
  getRegisteredTypes(): ValidatorType[] {
    return Array.from(this.validators.keys());
  }
}
