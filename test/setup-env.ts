import { config } from 'dotenv';
import { parseDatabaseUrl } from '../src/database/database.options';

config({ quiet: true });

const testUrl = parseDatabaseUrl(
  process.env.TEST_DATABASE_URL,
  'TEST_DATABASE_URL',
);
const testDatabase = decodeURIComponent(testUrl.pathname.slice(1));

if (!testDatabase.endsWith('_test')) {
  throw new Error(
    'TEST_DATABASE_URL must point to a disposable database ending in _test.',
  );
}

if (process.env.DATABASE_URL) {
  const appUrl = parseDatabaseUrl(process.env.DATABASE_URL, 'DATABASE_URL');
  const appDatabase = decodeURIComponent(appUrl.pathname.slice(1));

  if (appDatabase === testDatabase) {
    throw new Error(
      'TEST_DATABASE_URL must use a different database name from DATABASE_URL.',
    );
  }
}

// This runs before AppModule is imported; .env cannot override these values.
process.env.DATABASE_URL = testUrl.toString();
process.env.DATABASE_SSL = process.env.TEST_DATABASE_SSL ?? 'false';
