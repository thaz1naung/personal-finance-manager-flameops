import 'reflect-metadata';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import { createDatabaseOptions } from './database.options';

config({ quiet: true });

// The CLI initializes this connection only when a migration command is invoked.
export default new DataSource(createDatabaseOptions());
