import type { DataSourceOptions } from 'typeorm';
import { Category } from '../categories/entities/category.entity';
import { CreateCategories1795046400000 } from './migrations/1795046400000-create-categories';

export function parseDatabaseUrl(value: string | undefined, name: string): URL {
  let url: URL;

  try {
    url = new URL(value ?? '');
  } catch {
    throw new Error(`${name} must be a PostgreSQL connection URL.`);
  }

  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.hostname ||
    url.pathname.length <= 1 ||
    url.hash
  ) {
    throw new Error(`${name} must specify a PostgreSQL host and database.`);
  }

  return url;
}

export function createDatabaseOptions(
  env: Record<string, string | undefined> = process.env,
): Extract<DataSourceOptions, { type: 'postgres' }> {
  const url = parseDatabaseUrl(env.DATABASE_URL, 'DATABASE_URL');
  const ssl = env.DATABASE_SSL ?? 'false';

  if (ssl !== 'true' && ssl !== 'false') {
    throw new Error('DATABASE_SSL must be true or false.');
  }

  return {
    type: 'postgres',
    url: url.toString(),
    ssl: ssl === 'true' ? { rejectUnauthorized: true } : false,
    connectTimeoutMS: 5000,
    entities: [Category],
    migrations: [CreateCategories1795046400000],
    migrationsTableName: 'typeorm_migrations',
    migrationsTransactionMode: 'all',
    synchronize: false,
    migrationsRun: false,
    dropSchema: false,
    // gen_random_uuid() is built into PostgreSQL 13+; no extension DDL is needed.
    uuidExtension: 'pgcrypto',
    installExtensions: false,
  };
}
