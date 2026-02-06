---
description: Explains the project's database migration workflow and guidelines
---

# Migration Guidelines for this Project

This project uses **Drizzle ORM with a schema-first approach**.

## Important Rules:

1. **NEVER write manual SQL migration files** in `apps/backend/drizzle/*.sql`
2. **Always modify TypeScript schema files** in `apps/backend/src/db/schema/*.schema.ts`
3. **Use `pnpm db:generate`** to create migrations from schema changes
4. **Use `pnpm db:migrate`** to apply migrations

## Why?

- Manual SQL migrations break Drizzle's snapshot tracking system
- Schema files provide type safety and are the source of truth
- Drizzle generates optimized SQL from schema definitions

## Workflow:

```bash
cd apps/backend

# 1. Edit schema files (e.g., src/db/schema/assets.schema.ts)
# 2. Generate migration
pnpm db:generate

# 3. Review the generated SQL
# 4. Apply to database
pnpm db:migrate
```

## Exception:

Manual SQL is OK for **data migrations only** (INSERT/UPDATE/DELETE), not schema changes.
