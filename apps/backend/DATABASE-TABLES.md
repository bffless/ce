# Database Tables Reference

Quick reference for identifying tables in the `assethost` database.

## Your Application Tables

These are the tables you own and manage directly:

| Table           | Purpose                     | Managed By                |
| --------------- | --------------------------- | ------------------------- |
| `users`         | User accounts (email, role) | Your App (Drizzle schema) |
| `api_keys`      | API keys for GitHub Actions | Your App (Drizzle schema) |
| `assets`        | Uploaded files metadata     | Your App (Drizzle schema) |
| `system_config` | System configuration        | Your App (Drizzle schema) |

**Location:** `apps/backend/src/db/schema/`

## SuperTokens Tables (Actively Used)

These tables are used by your authentication system. **All SuperTokens tables are prefixed with `supertokens__`** to avoid conflicts:

| Table                                            | Purpose                                           | Used?     |
| ------------------------------------------------ | ------------------------------------------------- | --------- |
| `supertokens__emailpassword_users`               | User credentials (password hashes)                | ✅ Active |
| `supertokens__emailpassword_user_to_tenant`      | Multi-tenancy mapping                             | ✅ Active |
| `supertokens__all_auth_recipe_users`             | Unified user lookup across recipes                | ✅ Active |
| `supertokens__session_access_token_signing_keys` | JWT signing keys for sessions                     | ✅ Active |
| `supertokens__session_info`                      | Active user sessions                              | ✅ Active |
| `supertokens__apps`                              | SuperTokens app configuration                     | ✅ Active |
| `supertokens__app_id_to_user_id`                 | User ID mappings                                  | ✅ Active |
| `supertokens__userid_mapping`                    | Maps SuperTokens IDs to your database user IDs    | ✅ Active |
| `supertokens__key_value`                         | SuperTokens internal config                       | ✅ Active |
| `supertokens__jwt_signing_keys`                  | Token signing keys                                | ✅ Active |

## User ID Mapping

This application uses SuperTokens' **userid_mapping** feature to maintain your database user IDs as the primary user identifier throughout the system.

**How it works:**

1. When a user signs up, we create the user in our database **first** (gets a UUID)
2. Then create the user in SuperTokens (gets a SuperTokens-generated ID)
3. Create a mapping in `supertokens__userid_mapping` linking them
4. SuperTokens automatically uses **your database user ID** in sessions and APIs

**Benefits:**

- ✅ Your database user ID is the single source of truth
- ✅ `req.session.getUserId()` returns your DB user ID directly
- ✅ No need to store SuperTokens IDs in your database
- ✅ Simpler code - direct lookups with `getUserById()`
- ✅ Clean separation of concerns

**Example:**
```typescript
// During signup
const dbUser = await createUser(email, role); // Gets UUID: '123e4567-e89b-12d3-a456-426614174000'
const stResponse = await EmailPassword.signUp(email, password); // Gets ST ID: 'abc123...'
await createUserIdMapping({
  superTokensUserId: stResponse.recipeUserId.getAsString(),
  externalUserId: dbUser.id, // Your UUID
});

// Later in sessions
const userId = req.session.getUserId(); // Returns '123e4567-e89b-12d3-a456-426614174000' (your UUID!)
const user = await getUserById(userId); // Direct lookup
```

## SuperTokens Tables (Created but Unused)

These tables exist for features you're not currently using:

### Passwordless Authentication (OTP/Magic Links)

- `supertokens__passwordless_codes`
- `supertokens__passwordless_devices`
- `supertokens__passwordless_users`
- `supertokens__passwordless_user_to_tenant`

### OAuth/Social Login (Google, GitHub, etc.)

- `supertokens__oauth_clients`
- `supertokens__oauth_sessions`
- `supertokens__oauth_m2m_tokens`
- `supertokens__oauth_logout_challenges`
- `supertokens__thirdparty_users`
- `supertokens__thirdparty_user_to_tenant`

### Email Verification

- `supertokens__emailverification_verified_emails`
- `supertokens__emailverification_tokens`

### Two-Factor Authentication (TOTP)

- `supertokens__totp_users`
- `supertokens__totp_user_devices`
- `supertokens__totp_used_codes`

### Built-in Roles System

- `supertokens__roles`
- `supertokens__role_permissions`
- `supertokens__user_roles`
- `supertokens__userroles` (mapping table)

**Note:** You're using your own roles system (in `users.role` column), not SuperTokens' built-in roles.

### Other Features

- `supertokens__dashboard_users` - SuperTokens dashboard users
- `supertokens__dashboard_user_sessions` - Dashboard sessions
- `supertokens__bulk_import_users` - User migration tool
- `supertokens__user_metadata` - Extra user data storage

## How to Identify Tables

### By Naming Convention

**Your tables:** Clear, simple names related to your domain

```
users, api_keys, assets, system_config
```

**SuperTokens tables:** All prefixed with `supertokens__`

```
supertokens__emailpassword_*, supertokens__session_*, supertokens__oauth_*, supertokens__passwordless_*, etc.
```

### In SQL

```sql
-- List your application tables
SELECT table_name,
       pg_size_pretty(pg_total_relation_size(quote_ident(table_name))) as size
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('users', 'api_keys', 'assets', 'system_config')
ORDER BY table_name;

-- List SuperTokens tables with data
SELECT table_name,
       (SELECT COUNT(*) FROM information_schema.tables t2
        WHERE t2.table_name = t.table_name) as row_count
FROM information_schema.tables t
WHERE table_schema = 'public'
  AND table_name NOT IN ('users', 'api_keys', 'assets', 'system_config')
  AND table_type = 'BASE TABLE'
ORDER BY table_name;
```

### In Drizzle Studio

1. **Filter by name:**
   - Type `users`, `assets`, `api_keys` to see your tables
   - Type `emailpassword` or `session` to see active SuperTokens tables

2. **Check row counts:**
   - Your active tables: Will have data
   - SuperTokens tables: All prefixed with `supertokens__`
   - SuperTokens active tables: Will have data
   - Unused SuperTokens tables: 0 rows

## Table Ownership Summary

```
Total Tables in Database: ~30-35

Your Application:     4 tables  (users, api_keys, assets, system_config)
SuperTokens Active:   ~9 tables (email/password + sessions)
SuperTokens Unused:   ~20 tables (other auth methods)
```

## Why Are There So Many SuperTokens Tables?

SuperTokens creates all tables upfront for every supported auth method:

- Email/Password ✅ (you use this)
- Passwordless (OTP/Magic links)
- OAuth (Google, GitHub, etc.)
- Email Verification
- 2FA/TOTP
- Built-in RBAC
- Multi-tenancy

Even though you only use Email/Password, all infrastructure is ready if you want to add more auth methods later.

## Adding Your Own Tables

When you add new features, create new schema files in:

```
apps/backend/src/db/schema/
├── users.schema.ts         ✅ Exists
├── api-keys.schema.ts      ✅ Exists
├── assets.schema.ts        ✅ Exists
├── system-config.schema.ts ✅ Exists
└── your-new-table.schema.ts  ← Add here
```

Then export from `apps/backend/src/db/schema/index.ts`

## Quick Reference Commands

```bash
# Connect to database
docker exec -it assethost-postgres-dev psql -U postgres -d assethost

# List all tables with sizes
\dt+

# Count rows in your tables
SELECT 'users' as table, COUNT(*) FROM users
UNION ALL SELECT 'api_keys', COUNT(*) FROM api_keys
UNION ALL SELECT 'assets', COUNT(*) FROM assets
UNION ALL SELECT 'system_config', COUNT(*) FROM system_config;

# Count rows in active SuperTokens tables
SELECT 'emailpassword_users' as table, COUNT(*) FROM supertokens__emailpassword_users
UNION ALL SELECT 'all_auth_recipe_users', COUNT(*) FROM supertokens__all_auth_recipe_users
UNION ALL SELECT 'session_info', COUNT(*) FROM supertokens__session_info;

# Exit
\q
```

## Future Considerations

### Using Separate Schemas (Optional)

If you want clearer separation, you could configure SuperTokens to use a different PostgreSQL schema:

```sql
-- Create separate schema for SuperTokens
CREATE SCHEMA supertokens;

-- Your tables stay in 'public' schema
-- SuperTokens tables go in 'supertokens' schema
```

Then update SuperTokens connection:

```bash
POSTGRESQL_CONNECTION_URI=postgresql://postgres:password@postgres:5432/assethost?schema=supertokens
```

**Note:** This is optional and not necessary for most use cases.

## See Also

- SuperTokens tables documentation: https://supertokens.com/docs/emailpassword/pre-built-ui/setup/database-setup/postgresql
- Drizzle schema files: `apps/backend/src/db/schema/`
- Database migrations: `apps/backend/drizzle/`
