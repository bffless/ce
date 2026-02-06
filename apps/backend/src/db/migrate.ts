import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrationClient } from './client';

async function main() {
  console.log('Running migrations...');

  const db = drizzle(migrationClient);
  await migrate(db, { migrationsFolder: './drizzle' });

  console.log('Migrations completed!');
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed!');
  console.error(err);
  process.exit(1);
});
