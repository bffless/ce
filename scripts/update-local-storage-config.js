#!/usr/bin/env node
/**
 * Updates the storage configuration in the local database to use localhost
 * instead of Docker service names.
 *
 * Usage:
 *   node scripts/update-local-storage-config.js
 *
 * This is useful after syncing production data to local, since production
 * uses Docker service names (e.g., "minio") while local dev uses "localhost".
 */

const crypto = require('crypto');
const { Client } = require('pg');
const path = require('path');

// Load environment variables from root .env
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const ENCRYPTION_KEY = Buffer.from(process.env.ENCRYPTION_KEY, 'base64');
const ALGORITHM = 'aes-256-gcm';

function encryptData(data) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);

  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
}

async function main() {
  const localConfig = {
    endpoint: 'localhost',
    port: 9000,
    useSSL: false,
    accessKey: 'minioadmin',
    secretKey: 'minioadmin',
    bucket: 'assets',
  };

  const encrypted = encryptData(JSON.stringify(localConfig));

  const client = new Client({
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: 'devpassword',
    database: 'assethost',
  });

  try {
    await client.connect();

    const result = await client.query(
      `UPDATE system_config SET storage_config = $1, updated_at = NOW() RETURNING id`,
      [encrypted]
    );

    if (result.rowCount > 0) {
      console.log('Storage configuration updated successfully!');
      console.log('MinIO endpoint changed to: localhost:9000');
    } else {
      console.error('No system_config row found to update');
      process.exit(1);
    }
  } catch (error) {
    console.error('Error updating storage config:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
