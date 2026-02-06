import { defineConfig } from 'drizzle-kit';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from the backend directory
dotenv.config({ path: path.join(__dirname, '.env') });

export default defineConfig({
  schema: './src/db/schema/*.schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgresql://postgres:devpassword@localhost:5432/assethost',
  },
  verbose: true,
  strict: true,
});
