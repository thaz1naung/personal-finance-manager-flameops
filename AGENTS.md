# Agent guide

- Use Node.js from `.nvmrc` (`nvm install && nvm use`) and install with `npm ci`.
- This is a NestJS teaching API with three business routes, PostgreSQL persistence through TypeORM, and no user management.
- Group features into Nest modules. Controllers handle HTTP, services own business logic and state, and DTOs define validation and Swagger schemas.
- Store totals as PostgreSQL `numeric(12,2)`, calculate updates in integer cents, and expose currency-unit numbers in API responses. Lock the category row inside a transaction when adding spending.
- Schema changes use explicit TypeORM migrations (`npm run migrate`). Keep `synchronize`, `migrationsRun`, and automatic extension installation disabled. Register new migration classes in `src/database/database.options.ts`.
- Database tests require a disposable `TEST_DATABASE_URL` with a database name ending in `_test`, distinct from the application's database.
- Keep Swagger and `README.md` aligned with API changes.
- Before finishing code changes, run `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`, and `npm run format:check`.
