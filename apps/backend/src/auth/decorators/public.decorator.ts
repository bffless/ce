import { SetMetadata } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../session-auth.guard';

/**
 * Decorator to mark a route as public (no authentication required)
 * Use when a route should be accessible without authentication
 *
 * @example
 * @Public()
 * @Get('health')
 * checkHealth() { ... }
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
