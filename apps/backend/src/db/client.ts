import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const password = process.env.POSTGRES_PASSWORD || 'devpassword';
const connectionString =
  process.env.DATABASE_URL || `postgresql://postgres:${password}@localhost:5432/assethost`;

// For query purposes
const queryClient = postgres(connectionString, {
  max: parseInt(process.env.DB_POOL_SIZE || '5', 10),
});
export const db = drizzle(queryClient, { schema });

// For migrations
export const migrationClient = postgres(connectionString, { max: 1 });
