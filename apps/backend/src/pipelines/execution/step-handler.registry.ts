import { Injectable, Logger } from '@nestjs/common';
import { StepHandler } from './step-handler.interface';
import { HandlerType } from '../../db/schema';
import { HandlerNotFoundError } from '../errors';

/**
 * Registry for pipeline step handlers
 * Handlers register themselves on startup
 */
@Injectable()
export class StepHandlerRegistry {
  private readonly logger = new Logger(StepHandlerRegistry.name);
  private readonly handlers = new Map<HandlerType, StepHandler>();

  /**
   * Register a handler for a specific type
   */
  register(handler: StepHandler): void {
    if (this.handlers.has(handler.type)) {
      this.logger.warn(`Handler for type '${handler.type}' is being overwritten`);
    }
    this.handlers.set(handler.type, handler);
    this.logger.log(`Registered handler for type: ${handler.type}`);
  }

  /**
   * Get a handler by type
   * @throws HandlerNotFoundError if handler is not registered
   */
  get(type: HandlerType, stepName?: string): StepHandler {
    const handler = this.handlers.get(type);
    if (!handler) {
      throw new HandlerNotFoundError(type, stepName);
    }
    return handler;
  }

  /**
   * Check if a handler is registered
   */
  has(type: HandlerType): boolean {
    return this.handlers.has(type);
  }

  /**
   * Get all registered handler types
   */
  getRegisteredTypes(): HandlerType[] {
    return Array.from(this.handlers.keys());
  }
}
