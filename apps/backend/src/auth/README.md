# Authentication Module

This module provides authentication and authorization for the Static Asset Hosting Platform using SuperTokens for session management and bcrypt for API key authentication.

## Features

- **Email/Password Authentication** via SuperTokens
- **Session Management** with JWT tokens
- **API Key Authentication** for GitHub Actions
- **Role-Based Access Control (RBAC)**
- **Custom Decorators** for easy route protection

## Architecture

### Authentication Methods

1. **Session-Based Auth (SuperTokens)**
   - Used for web application users
   - JWT tokens with automatic refresh
   - Secure cookie-based session management
   - Handled by `SessionAuthGuard`

2. **API Key Auth**
   - Used for GitHub Actions and programmatic access
   - Hashed keys stored in database
   - Repository-level access control
   - Expiration and revocation support
   - Handled by `ApiKeyGuard`

### Guards

#### SessionAuthGuard

Verifies SuperTokens session for web users.

```typescript
@UseGuards(SessionAuthGuard)
@Get('profile')
getProfile(@CurrentUser() user: CurrentUserData) {
  return user;
}
```

#### ApiKeyGuard

Validates API keys from `X-API-Key` header.

```typescript
@UseGuards(ApiKeyGuard)
@Post('upload')
uploadAsset(@CurrentUser() user: CurrentUserData) {
  // user.allowedRepositories contains permitted repos
}
```

#### RolesGuard

Enforces role-based access control.

```typescript
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles('admin')
@Get('admin/users')
getAllUsers() {
  // Only accessible to admins
}
```

### Decorators

#### @Public()

Marks a route as public (no authentication required).

```typescript
@Public()
@Get('health')
checkHealth() {
  return { status: 'ok' };
}
```

#### @Roles(...roles)

Specifies required roles for a route.

```typescript
@Roles('admin', 'moderator')
@Delete('users/:id')
deleteUser(@Param('id') id: string) {
  // Only admins and moderators can access
}
```

#### @CurrentUser(property?)

Injects current user data into route handler.

```typescript
// Get full user object
@Get('me')
getProfile(@CurrentUser() user: CurrentUserData) {
  return user;
}

// Get specific property
@Get('email')
getEmail(@CurrentUser('email') email: string) {
  return { email };
}
```

## Environment Variables

```bash
# SuperTokens Configuration - Docker (recommended)
SUPERTOKENS_CONNECTION_URI=http://localhost:3567  # Local Docker instance
SUPERTOKENS_API_KEY=                              # Not needed for self-hosted

# Alternative: Use demo instance (not for production)
# SUPERTOKENS_CONNECTION_URI=https://try.supertokens.com

# Alternative: Use managed service
# SUPERTOKENS_CONNECTION_URI=https://your-app.supertokens.io
# SUPERTOKENS_API_KEY=your-api-key

# Application URLs
API_DOMAIN=http://localhost:3000
FRONTEND_URL=http://localhost:5173

# Admin user
ADMIN_EMAIL=admin@example.com
```

**Getting Started:**

1. Start SuperTokens with Docker Compose:
   ```bash
   docker-compose -f docker-compose.dev.yml up -d
   ```

2. SuperTokens uses your existing PostgreSQL database and creates its own prefixed tables (`supertokens_*`)

3. See `SUPERTOKENS-DOCKER-SETUP.md` for full setup guide

## Endpoints

**Note:** All authentication endpoints are at `/api/auth/*`. Native SuperTokens endpoints (`/auth/signup`, `/auth/signin`) are disabled.

### POST /api/auth/signup

Register a new user.

**Request:**

```json
{
  "email": "user@example.com",
  "password": "SecurePassword123!"
}
```

**Response:**

```json
{
  "message": "User registered successfully",
  "user": {
    "id": "uuid",
    "email": "user@example.com"
  }
}
```

### POST /api/auth/signin

Sign in a user.

**Request:**

```json
{
  "email": "user@example.com",
  "password": "SecurePassword123!"
}
```

**Response:**

```json
{
  "message": "Signed in successfully",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "role": "user"
  }
}
```

Session cookies are set automatically.

### POST /api/auth/signout

Sign out current user (revokes session).

**Response:**

```json
{
  "message": "Signed out successfully"
}
```

### GET /auth/session

Get current session information.

**Response:**

```json
{
  "session": {
    "userId": "uuid",
    "handle": "session-handle"
  },
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "role": "user"
  }
}
```

### POST /auth/refresh

Refresh access token (handled automatically by SuperTokens middleware).

## Usage Examples

### Protecting Routes

```typescript
import { Controller, Get, UseGuards } from '@nestjs/common';
import { SessionAuthGuard, RolesGuard, Roles, CurrentUser } from './auth';

@Controller('api/users')
@UseGuards(SessionAuthGuard, RolesGuard)
export class UsersController {
  // Any authenticated user can access
  @Get('me')
  getMyProfile(@CurrentUser() user: CurrentUserData) {
    return user;
  }

  // Only admins can access
  @Roles('admin')
  @Get('all')
  getAllUsers() {
    return this.usersService.findAll();
  }
}
```

### API Key Protected Routes

```typescript
import { Controller, Post, UseGuards } from '@nestjs/common';
import { ApiKeyGuard, CurrentUser } from './auth';

@Controller('api/assets')
@UseGuards(ApiKeyGuard)
export class AssetsController {
  @Post('upload')
  uploadAsset(@CurrentUser() user: CurrentUserData) {
    // Check allowed repositories
    const allowedRepos = user.allowedRepositories;
    // ... upload logic
  }
}
```

### Mixed Authentication

Support both session and API key authentication:

```typescript
import { Controller, Post, UseGuards } from '@nestjs/common';
import { SessionAuthGuard, ApiKeyGuard } from './auth';

// Custom guard that accepts either
@Injectable()
export class SessionOrApiKeyGuard implements CanActivate {
  constructor(
    private sessionGuard: SessionAuthGuard,
    private apiKeyGuard: ApiKeyGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Try session auth first
    try {
      return await this.sessionGuard.canActivate(context);
    } catch {
      // Fall back to API key auth
      return await this.apiKeyGuard.canActivate(context);
    }
  }
}
```

## Security Considerations

### Password Requirements

- Minimum 8 characters
- Additional validation can be added in the signup endpoint

### API Key Security

- Keys are hashed using bcrypt before storage
- Keys are only shown once upon creation
- Support for expiration dates
- Support for repository-level restrictions
- Last used timestamp for auditing

### Session Security

- Secure cookies in production (HTTPS only)
- HttpOnly cookies (not accessible via JavaScript)
- SameSite cookie attribute
- Automatic session refresh
- Session revocation on signout

### CORS Configuration

Configured in `main.ts` to allow credentials:

```typescript
app.enableCors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
});
```

## Testing

Run unit tests:

```bash
pnpm test auth
```

Run specific test file:

```bash
pnpm test auth.service.spec.ts
pnpm test session-auth.guard.spec.ts
pnpm test api-key.guard.spec.ts
pnpm test roles.guard.spec.ts
```

## Database Schema

### users table

```typescript
{
  id: uuid (primary key),
  email: varchar(255) unique,
  role: varchar(50) default 'user',  // 'admin' | 'user'
  createdAt: timestamp,
  updatedAt: timestamp
}
```

### api_keys table

```typescript
{
  id: uuid (primary key),
  name: varchar(255),
  key: varchar(255) unique,  // hashed with bcrypt
  userId: uuid (foreign key -> users.id),
  allowedRepositories: text,  // JSON array as string
  expiresAt: timestamp (nullable),
  lastUsedAt: timestamp (nullable),
  createdAt: timestamp
}
```

## Troubleshooting

### "No active session" error

- Ensure cookies are being sent with requests
- Check CORS configuration allows credentials
- Verify frontend is sending cookies

### "Invalid API key" error

- Check X-API-Key header is present
- Verify key hasn't expired
- Ensure key hasn't been revoked
- Check key is being passed correctly (no extra spaces)

### "Access denied" with roles

- Verify user has required role in database
- Check RolesGuard is applied after SessionAuthGuard
- Ensure user is authenticated before role check

## Migration from Other Auth Systems

If migrating from another authentication system:

1. User data can be imported into the `users` table
2. SuperTokens will create its own tables for session management
3. Existing passwords need to be migrated through a password reset flow
4. API keys should be regenerated for security

## Production Deployment

### Option 1: Self-Hosted (Recommended - Already Configured!)

**✅ SuperTokens is already configured in your Docker Compose files!**

**Development:**
```bash
docker-compose -f docker-compose.dev.yml up -d
# Includes: PostgreSQL, MinIO, and SuperTokens
```

**Production:**
```bash
docker-compose up -d
# SuperTokens automatically included
```

**Configuration:**
- Uses your existing PostgreSQL database
- Creates prefixed tables (`supertokens_*`)
- No API key required
- Internal Docker network communication

See `SUPERTOKENS-DOCKER-SETUP.md` for full details.

**Pros:**
- ✅ Full control
- ✅ Private and secure
- ✅ Uses your existing PostgreSQL
- ✅ Free forever
- ✅ Production-ready
- ✅ Already configured!

### Option 2: SuperTokens Managed Service

Sign up at https://supertokens.com for their managed hosting:

```bash
SUPERTOKENS_CONNECTION_URI=https://your-app.supertokens.io
SUPERTOKENS_API_KEY=your-api-key-here
```

**Pros:**
- ✅ Managed infrastructure
- ✅ Automatic updates
- ✅ Built-in monitoring
- ✅ Support

**Cons:**
- ❌ Costs money (after free tier)

### Option 3: Demo Instance (Development Only)

Use try.supertokens.com for quick testing:

```bash
SUPERTOKENS_CONNECTION_URI=https://try.supertokens.com
```

**Note:** Only for initial testing. Use Docker setup (Option 1) for actual development.

**Limitations:**
- ⚠️ Shared demo instance
- ⚠️ No reliability guarantees
- ⚠️ Data may be wiped
- ⚠️ Not for production

## Further Reading

- [SuperTokens Documentation](https://supertokens.com/docs)
- [NestJS Guards](https://docs.nestjs.com/guards)
- [NestJS Authentication](https://docs.nestjs.com/security/authentication)
