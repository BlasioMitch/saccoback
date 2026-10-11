// Where the API tests run: TEST_DATABASE_URL, or the .env database renamed to finapp_test.
// Each Jest worker gets its own copy (finapp_w1_test, finapp_w2_test, …) because test files run in parallel
// and every file drops and recreates its tables. Only names ending in _test are ever used.
import fs from 'fs';
import path from 'path';

function baseUrl() {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const envFile = path.resolve('.env');
  const line = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8').split('\n').find(entry => entry.startsWith('DATABASE_URL=')) : null;
  if (!line) throw new Error('Set TEST_DATABASE_URL (a database whose name ends in _test)');
  const parsed = new URL(line.slice('DATABASE_URL='.length).trim());
  parsed.pathname = '/finapp_test';
  parsed.search = '';
  return parsed.toString();
}

export function testDatabaseUrl(worker = process.env.JEST_WORKER_ID || '1') {
  const url = new URL(baseUrl());
  const name = url.pathname.slice(1);
  if (!name.endsWith('_test')) throw new Error(`Refusing to run the API tests against "${name}": the database name must end in _test`);
  url.pathname = `/${name.slice(0, -'_test'.length)}_w${worker}_test`;
  return url.toString();
}
