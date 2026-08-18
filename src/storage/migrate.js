import 'dotenv/config';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function migrate() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in first.');
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const sql = readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');

  console.log('[migrate] Applying schema.sql...');
  await pool.query(sql);
  console.log('[migrate] Done — "jobs" table is ready.');

  await pool.end();
}

migrate().catch((err) => {
  console.error('[migrate] Failed:', err.message);
  process.exit(1);
});
