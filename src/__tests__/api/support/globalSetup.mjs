// Creates one test database per Jest worker if missing (tables are made by each test file)
import pg from 'pg';
import { testDatabaseUrl } from './testDatabase.mjs';

export default async function globalSetup(globalConfig) {
  const workers = Math.max(1, Number(globalConfig?.maxWorkers) || 1);
  const admin = new URL(testDatabaseUrl('1'));
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    for (let worker = 1; worker <= workers; worker += 1) {
      const name = new URL(testDatabaseUrl(String(worker))).pathname.slice(1);
      const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
      if (!rowCount) await client.query(`CREATE DATABASE "${name}"`);
    }
  } finally {
    await client.end();
  }
}
