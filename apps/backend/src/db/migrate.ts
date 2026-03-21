import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { migrationClient } from './client';

async function main() {
  console.log('Running migrations...');

  const db = drizzle(migrationClient);

  // Enable pgvector extension if available (Cloud SQL, pgvector Docker image, etc.)
  try {
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
    console.log('pgvector extension enabled');
  } catch {
    console.log('pgvector extension not available — vector search features will be disabled');
  }

  await migrate(db, { migrationsFolder: './drizzle' });

  console.log('Migrations completed!');
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed!');
  console.error(err);
  process.exit(1);
});
