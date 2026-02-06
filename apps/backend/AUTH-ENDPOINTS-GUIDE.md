# Authentication Endpoints Guide

## Architecture Note

This application uses SuperTokens' **userid_mapping** feature. When users sign up:

1. User created in our database first → gets UUID (e.g., `'123e4567-...'`)
2. User created in SuperTokens → gets SuperTokens ID (e.g., `'abc123...'`)
3. Mapping created linking them
4. All sessions and APIs use **your database UUID** as the user ID

This means `req.session.getUserId()` returns your database UUID, not SuperTokens' ID. See `DATABASE-TABLES.md` for details.

## Authentication Endpoints

**All authentication goes through custom NestJS endpoints at `/api/auth/*`**

The native SuperTokens signup/signin endpoints at `/auth/*` have been **disabled** to ensure all users go through our custom logic (database user creation, userid_mapping, role assignment).

### Available Endpoints → `/api/auth/*`

| Endpoint            | Method | Description       |
| ------------------- | ------ | ----------------- |
| `/api/auth/signup`  | POST   | Register new user |
| `/api/auth/signin`  | POST   | Login user        |
| `/api/auth/signout` | POST   | Logout user       |
| `/api/auth/session` | GET    | Get session info  |
| `/api/auth/refresh` | POST   | Refresh token     |

**Request Format:**

```json
{
  "email": "user@example.com",
  "password": "SecurePassword123!"
}
```

### Why Custom Endpoints?

Our custom endpoints ensure:
- ✅ Database user record is created
- ✅ SuperTokens-to-database user ID mapping is established
- ✅ Admin role is assigned correctly
- ✅ Simple, consistent request format
- ✅ Custom validation and error handling

## Quick Start

### Step 1: Start Services

```bash
# Terminal 1: Start SuperTokens
docker-compose -f docker-compose.dev.yml up -d

# Terminal 2: Start backend
cd apps/backend
pnpm dev
```

### Step 2: Test Signup (Swagger UI)

1. Go to http://localhost:3000/api/docs
2. Find **POST /api/auth/signup**
3. Click "Try it out"
4. Use this request body:

```json
{
  "email": "test@example.com",
  "password": "Test1234!"
}
```

5. Click "Execute"

**Expected Response (201):**

```json
{
  "message": "User registered successfully",
  "user": {
    "id": "...",
    "email": "test@example.com"
  }
}
```

### Step 3: Test Signin

1. Find **POST /api/auth/signin**
2. Use same credentials:

```json
{
  "email": "test@example.com",
  "password": "Test1234!"
}
```

**Expected Response (200):**

```json
{
  "message": "Signed in successfully",
  "user": {
    "id": "...",
    "email": "test@example.com",
    "role": "user"
  }
}
```

Cookies will be set automatically!

### Step 4: Test Session

**⚠️ Important:** Swagger UI sometimes doesn't send cookies properly. Use one of these methods:

#### Method A: Browser Console (Recommended)

1. Keep Swagger UI open (you must be signed in)
2. Open **DevTools Console** (F12)
3. Run this:

```javascript
fetch('http://localhost:3000/api/auth/session', {
  credentials: 'include',
})
  .then((r) => r.json())
  .then((data) => console.log('Session:', data))
  .catch((err) => console.error('Error:', err));
```

#### Method B: curl

```bash
# First, sign in and save cookies
curl -X POST http://localhost:3000/api/auth/signin \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test1234!"}' \
  -c cookies.txt

# Then check session
curl http://localhost:3000/api/auth/session -b cookies.txt
```

#### Method C: Try Swagger UI

1. Find **GET /api/auth/session**
2. Click "Execute" (no body needed)

**Expected Response (200):**

```json
{
  "session": {
    "userId": "...",
    "handle": "..."
  },
  "user": {
    "id": "...",
    "email": "test@example.com",
    "role": "user"
  }
}
```

**If you get 401 in Swagger:** This is normal - use Method A or B instead.

## Via curl

### Signup

```bash
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Test1234!"
  }'
```

### Signin (save cookies)

```bash
curl -X POST http://localhost:3000/api/auth/signin \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Test1234!"
  }' \
  -c cookies.txt
```

### Get Session (use cookies)

```bash
curl http://localhost:3000/api/auth/session \
  -b cookies.txt
```

### Signout

```bash
curl -X POST http://localhost:3000/api/auth/signout \
  -b cookies.txt
```

## Troubleshooting

### "Cannot POST /auth/signup" or "Cannot POST /auth/signin"

❌ **Problem:** Trying to use native SuperTokens endpoints (disabled)
✅ **Solution:** Use `/api/auth/signup` and `/api/auth/signin` instead

The native SuperTokens endpoints are intentionally disabled. All authentication must go through the custom endpoints.

### "Cannot POST /api/auth/signup"

❌ **Problem:** Backend not running
✅ **Solution:**

```bash
cd apps/backend && pnpm dev
```

### "Connection refused"

❌ **Problem:** SuperTokens not running
✅ **Solution:**

```bash
docker-compose -f docker-compose.dev.yml up -d
curl http://localhost:3567/hello  # Should return "Hello"
```

### "401 Unauthorized" on protected routes

❌ **Problem:** Not signed in or cookies not sent  
✅ **Solution:**

- Sign in first via `/api/auth/signin`
- Ensure cookies are included in requests
- In Swagger UI, cookies are handled automatically
- With curl, use `-c cookies.txt` and `-b cookies.txt`

## Database Check

After signup, verify the user was created:

```bash
# Connect to database
docker exec -it assethost-postgres-dev psql -U postgres -d assethost

# Check SuperTokens user
SELECT * FROM emailpassword_users;

# Check your app's user table
SELECT * FROM users;

# Exit
\q
```

You should see:

- 1 row in `emailpassword_users` (SuperTokens credentials)
- 1 row in `users` (your app's user record)
- 1 row in `all_auth_recipe_users` (SuperTokens user lookup)

## Password Requirements

Current validation:

- ✅ Minimum 8 characters
- ❌ No uppercase requirement (yet)
- ❌ No number requirement (yet)
- ❌ No special character requirement (yet)

**Examples:**

- ✅ `Test1234!` - Valid
- ✅ `MyPassword123` - Valid
- ❌ `short` - Too short (< 8 chars)
- ❌ `` - Empty

## Admin User

The first user created with email matching `ADMIN_EMAIL` env var becomes admin:

```bash
# In apps/backend/.env
ADMIN_EMAIL=admin@example.com
```

Then signup with that email:

```bash
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "Admin123!"
  }'
```

Check role:

```sql
SELECT id, email, role FROM users WHERE email = 'admin@example.com';
-- Should show role = 'admin'
```

## API Documentation

Full Swagger docs available at:

- http://localhost:3000/api/docs

Look for the **Authentication** section with all endpoints.

## Next Steps

After authentication works:

1. **Section 1.4:** Users Module
   - Use `@UseGuards(SessionAuthGuard)` to protect routes
   - Use `@CurrentUser()` to get authenticated user
2. **Section 1.5:** API Keys Module
   - Create API keys via authenticated endpoints
   - Test with `ApiKeyGuard`

3. **Section 1.6:** Assets Module
   - Upload files with authentication
   - Use both session and API key auth

## Summary

```
✅ All endpoints: /api/auth/*
❌ Native SuperTokens endpoints (/auth/signup, /auth/signin) are DISABLED

Simple request format: {email, password}

Start backend → pnpm dev
Test signup → POST /api/auth/signup
Test signin → POST /api/auth/signin
Check session → GET /api/auth/session
```

**Important:** The native SuperTokens signup/signin endpoints are disabled to ensure all users are properly created in both the database and SuperTokens with correct user ID mapping.

Happy authenticating! 🎉
