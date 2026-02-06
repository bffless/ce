// Module
export { AuthModule } from './auth.module';

// Services
export { AuthService } from './auth.service';

// Guards
export { SessionAuthGuard } from './session-auth.guard';
export { ApiKeyGuard } from './api-key.guard';
export { RolesGuard } from './roles.guard';
export { EmailVerificationGuard } from './email-verification.guard';

// Decorators
export { Roles } from './decorators/roles.decorator';
export { Public } from './decorators/public.decorator';
export { SkipEmailVerification } from './decorators/skip-email-verification.decorator';
export { CurrentUser, CurrentUserData } from './decorators/current-user.decorator';

// Middleware
export { AuthMiddleware } from './auth.middleware';
export { TenantMiddleware } from './tenant.middleware';

// Config
export { initSuperTokens } from './supertokens.config';

// Tenant Utilities (Platform Mode Only)
export { registerTenant, deleteTenant, getTenant } from './tenant-registration';
