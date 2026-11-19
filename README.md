# Personal Finance Manager API

A small NestJS API for teaching application deployment and integration. Spending categories and accumulated totals are persisted in PostgreSQL through TypeORM. Schema changes are applied explicitly with migration commands.

## Requirements

- **Node.js 26.13.1 LTS (Lithium)**, pinned in `.nvmrc`.
- **npm 11.20.0**, included with that Node release.
- **PostgreSQL 14 or newer**, provided externally, with an existing database and a role that can create tables and indexes when running migrations.

These are the latest Node LTS release and its bundled npm version at project setup. The lockfile pins dependency versions; TypeScript stays on the 6.0 release line supported by the NestJS Swagger and testing/linting tools.

## Run locally

From this directory, with [nvm](https://github.com/nvm-sh/nvm) installed:

```sh
nvm install
nvm use
npm ci
cp .env.example .env
```

Edit `.env` with the connection URL for your PostgreSQL database, then run:

```sh
npm run migrate
npm run start:dev
```

- API: <http://localhost:3000/categories>
- Swagger UI: <http://localhost:3000/docs>
- OpenAPI JSON: <http://localhost:3000/docs-json>

Swagger documents all three business routes, including input/output schemas, examples, and error responses. You can also call the API directly from Swagger UI.

### Troubleshooting Node version errors

Installing Node with `nvm` does not switch already-open terminals, and new terminals may select your existing `nvm` default. The `.nvmrc` file records the project's version; run `nvm use` in each terminal to activate it.

If startup reports `ERR_REQUIRE_CYCLE_MODULE` involving `ora` on Node `22.14.0`, select the project's Node release in that same terminal:

```sh
nvm use
node --version # v26.13.1
npm run start:dev
```

The `devEngines` setting in `package.json` makes npm check the Node version before installing dependencies or running scripts. An unsupported runtime now produces an `EBADDEVENGINES` error showing the current and required versions before Nest CLI starts. Resolve it with `nvm use` as shown above.

### Configuration

| Variable            | Default            | Meaning                                                                         |
| ------------------- | ------------------ | ------------------------------------------------------------------------------- |
| `DATABASE_URL`      | Required           | PostgreSQL connection URL, including credentials, host, port, and database name |
| `DATABASE_SSL`      | `false`            | Set to `true` to enable TLS with certificate verification                       |
| `PORT`              | `3000`             | HTTP port, an integer from 1 to 65535                                           |
| `TEST_DATABASE_URL` | Required for tests | Separate, disposable database whose name ends in `_test`                        |
| `TEST_DATABASE_SSL` | `false`            | TLS setting for the test database                                               |

Pass configuration through environment variables:

```sh
PORT=4000 npm run start:dev
```

The application and migration CLI both load `.env` from the project directory. Existing process environment variables take precedence. `.env` files are excluded from Git; `.env.example` contains placeholders only. Percent-encode reserved characters in URL credentials.

For TLS connections with a private certificate authority, set Node's `NODE_EXTRA_CA_CERTS` to the CA certificate file before starting the process. Keep connection URLs free of SSL query parameters when using `DATABASE_SSL`, because PostgreSQL URL parameters can override driver SSL options.

The server binds to `0.0.0.0` for use in containers and deployment platforms. Provision the database externally before starting the application or running migrations.

## API

| Method | Path                      | Success | Purpose                           |
| ------ | ------------------------- | ------- | --------------------------------- |
| `POST` | `/categories`             | `201`   | Create a spending category        |
| `POST` | `/categories/:id/amounts` | `200`   | Add spending to a category        |
| `GET`  | `/categories`             | `200`   | List every category and its total |

### 1. Create a category

```sh
curl -i -X POST http://localhost:3000/categories \
  -H 'Content-Type: application/json' \
  -d '{"name":"Food"}'
```

Example response (the ID is generated):

```json
{
  "id": "d46c9ef0-8e3b-4c9c-b8e4-aa7a77de8297",
  "name": "Food",
  "totalAmount": 0
}
```

Names are trimmed, must contain 1–100 characters, and must be unique ignoring case. Creating `" food "` after `"Food"` returns `409 Conflict`.

### 2. Add spending

Set `CATEGORY_ID` to the ID returned by your create request:

```sh
CATEGORY_ID='paste-the-returned-id-here'

curl -i -X POST "http://localhost:3000/categories/$CATEGORY_ID/amounts" \
  -H 'Content-Type: application/json' \
  -d '{"amount":12.50}'
```

Example response:

```json
{
  "id": "d46c9ef0-8e3b-4c9c-b8e4-aa7a77de8297",
  "name": "Food",
  "totalAmount": 12.5
}
```

Amounts must be JSON numbers of at least `0.01`, with at most two decimal places. Both a single amount and a category's accumulated total are capped at `1,000,000,000` to keep integer-cent arithmetic and numeric responses precise. Invalid input leaves the previous total unchanged.

Amounts use one implicit currency; choose the currency for your lesson or integration. PostgreSQL stores totals as exact `numeric(12,2)` values. The service calculates changes in integer cents, so adding `0.10` and `0.20` produces `0.30`. JSON numbers do not retain trailing zeros, so a response may display `0.3` or `12.5`.

Each successful request adds spending again. Sending the same request twice adds the amount twice.

### 3. List totals

```sh
curl http://localhost:3000/categories
```

```json
[
  {
    "id": "d46c9ef0-8e3b-4c9c-b8e4-aa7a77de8297",
    "name": "Food",
    "totalAmount": 12.5
  }
]
```

Categories are ordered by their internal creation timestamp, with UUID as a deterministic tie-breaker, including categories with zero spending. An empty database returns `[]`.

### Errors

| Status            | Meaning                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `400 Bad Request` | Invalid body, unexpected fields, invalid UUID, or an amount/total outside the allowed range |
| `404 Not Found`   | A valid category UUID does not exist                                                        |
| `409 Conflict`    | A category name already exists                                                              |

Errors use NestJS's standard shape. `message` is a string or an array of validation messages:

```json
{
  "statusCode": 400,
  "message": ["amount must not be less than 0.01"],
  "error": "Bad Request"
}
```

## Architecture

```text
src/
  main.ts                         # Bootstrap, port, shutdown handling
  app.module.ts                   # Root module
  setup-app.ts                    # Shared request validation and Swagger setup
  database/
    database.module.ts            # NestJS database connection
    database.options.ts           # Shared connection options and migration registry
    data-source.ts                # Standalone TypeORM CLI DataSource
    migrations/                   # Explicit, reversible schema migrations
  categories/
    categories.module.ts          # Feature wiring
    categories.controller.ts      # The three business routes
    categories.service.ts         # Business logic, repository, and transactions
    categories.constants.ts       # Money bounds
    dto/                          # Validated inputs and documented response shapes
    entities/category.entity.ts   # TypeORM object-relational mapping
test/
  setup-env.ts                    # Dedicated test database checks
  categories.e2e-spec.ts           # PostgreSQL-backed HTTP integration tests
```

`DatabaseModule` configures TypeORM, and `CategoriesModule` registers the `Category` entity with `TypeOrmModule.forFeature()`. NestJS injects its repository into `CategoriesService`. Controllers delegate to the service, while DTO decorators define request validation and OpenAPI schemas.

### Database schema

The `categories` table maps the existing category DTO to a relational entity:

| Column         | PostgreSQL type | Rules                                                        |
| -------------- | --------------- | ------------------------------------------------------------ |
| `id`           | `uuid`          | Primary key, generated by `gen_random_uuid()`                |
| `name`         | `varchar(100)`  | Required; database checks reject empty or space-padded names |
| `total_amount` | `numeric(12,2)` | Required, default `0`, checked range `0–1,000,000,000`       |
| `created_at`   | `timestamptz`   | Creation timestamp, default `now()`, not exposed by the API  |

A unique index on `LOWER(name)` enforces case-insensitive uniqueness, including simultaneous create requests. A composite index supports ordering by `created_at` and `id`. PostgreSQL numeric values are represented as strings in the entity and converted to bounded JSON numbers in the response DTO.

Adding spending uses a transaction with a pessimistic row lock (`SELECT ... FOR UPDATE`). The lock covers reading the current total, validating the limit, and saving the new total. Concurrent requests and multiple application instances therefore cannot lose increments or jointly exceed the limit.

Data survives application restarts and redeployments. Application instances connected to the same database share categories and totals. This API has no authentication or user separation, and keeps accumulated totals rather than individual transaction records.

## Explicit migrations

Both the application and CLI use the same entity and migration configuration:

```json
{
  "synchronize": false,
  "migrationsRun": false,
  "installExtensions": false
}
```

Application startup connects to PostgreSQL but never synchronizes the schema, runs migrations, or installs extensions. `gen_random_uuid()` is built into the supported PostgreSQL versions. The initial migration creates `categories`, its constraints, and its indexes. TypeORM records applied migrations in `typeorm_migrations`.

| Command                    | Purpose                                                  |
| -------------------------- | -------------------------------------------------------- |
| `npm run migrate`          | Build the application, then apply pending migrations     |
| `npm run migrate:run`      | Apply migrations from an already-built `dist/` directory |
| `npm run migration:show`   | Build and display applied/pending migrations             |
| `npm run migration:revert` | Build and revert the most recently applied migration     |

Running `migrate` again after success does not reapply completed migrations. Migration batches run in a transaction. Reverting the initial migration drops `categories` and its data.

For a future schema change, update the entity, add a timestamped migration class with `up()` and `down()` methods under `src/database/migrations/`, and register it in the `migrations` array in `src/database/database.options.ts`. Keep already-applied migrations unchanged. Review and execute `npm run migrate` as a separate deployment step.

## Build and run for deployment

Configure `DATABASE_URL`, select the pinned Node release, install dependencies, and explicitly migrate before starting:

```sh
nvm use
npm ci
npm run migrate
PORT=3000 npm run start:prod
```

For a deployment platform, use `npm ci && npm run build` as the build command, `npm run migrate:run` as a separately invoked release/migration step, and `npm run start:prod` as the start command. Run the migration step once before deploying application replicas. Configure the Node runtime from `.nvmrc`/`package.json`.

The build step needs development dependencies. A separate runtime stage can install only production dependencies with `npm ci --omit=dev` and copy the compiled `dist/` directory from the build stage. `migrate:run` works with production dependencies and compiled migrations; `migrate`, `migration:show`, and `migration:revert` include a build and require development dependencies.

The application handles shutdown signals through NestJS shutdown hooks.

## Checks

Provision a separate database such as `personal_finance_test` and set `TEST_DATABASE_URL` in `.env` or the environment. Its database name must end in `_test` and differ from the name in `DATABASE_URL`, including when different credentials or host aliases are used. Test setup also verifies the actual connected database before applying migrations or clearing data.

```sh
npm run build
npm run typecheck
npm run lint
npm test
npm run format:check
```

The test runner explicitly applies the registered migrations to the test database and clears `categories` before each test. It does not create the database or fall back to the application database.

Tests exercise real PostgreSQL and NestJS routing: category creation, validation, exact totals, database constraints, concurrent additions across application instances, concurrent duplicate creation, persistence across application recreation, total limits, and Swagger documentation.

The test command enables Node's VM module support so Jest can load NestJS 12's ESM packages. Node may print an experimental VM modules notice during tests; the application itself runs without that flag.

Use `npm run format` to apply Prettier formatting.
