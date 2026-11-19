import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { MAX_CATEGORY_TOTAL } from '../src/categories/categories.constants';
import type { CategoryResponseDto } from '../src/categories/dto/category-response.dto';
import { Category } from '../src/categories/entities/category.entity';
import { createDatabaseOptions } from '../src/database/database.options';
import { setupApp } from '../src/setup-app';

describe('Categories API', () => {
  let app: INestApplication;
  let server: Server;
  let database: DataSource;

  async function createApplication(): Promise<INestApplication> {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    const application = module.createNestApplication();
    setupApp(application);
    await application.init();
    return application;
  }

  beforeAll(async () => {
    database = new DataSource(createDatabaseOptions());
    await database.initialize();

    // Verify the actual database before any migration or destructive test setup.
    const [connection] = await database.query<{ database: string }[]>(
      'SELECT current_database() AS "database"',
    );
    const expectedDatabase = decodeURIComponent(
      new URL(process.env.TEST_DATABASE_URL!).pathname.slice(1),
    );
    expect(connection.database).toBe(expectedDatabase);
    expect(connection.database).toMatch(/_test$/);

    // Tests explicitly apply migrations; application startup never does.
    await database.runMigrations();
  });

  beforeEach(async () => {
    await database.getRepository(Category).clear();
    app = await createApplication();
    server = app.getHttpServer() as Server;
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.destroy();
    }
  });

  async function createCategory(name = 'Food'): Promise<CategoryResponseDto> {
    const response = await request(server)
      .post('/categories')
      .send({ name })
      .expect(201);

    return response.body as CategoryResponseDto;
  }

  it('starts with an empty category list', async () => {
    await request(server).get('/categories').expect(200, []);
  });

  it('creates a trimmed category with a UUID and zero spending', async () => {
    const category = await createCategory('  Food  ');

    expect(category.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(category).toEqual({
      id: category.id,
      name: 'Food',
      totalAmount: 0,
    });
    await request(server).get('/categories').expect(200, [category]);
  });

  it('accumulates exact cent totals and keeps categories independent', async () => {
    const food = await createCategory('Food');
    const transport = await createCategory('Transport');

    await request(server)
      .post(`/categories/${food.id}/amounts`)
      .send({ amount: 0.1 })
      .expect(200, { ...food, totalAmount: 0.1 });
    await request(server)
      .post(`/categories/${food.id}/amounts`)
      .send({ amount: 0.2 })
      .expect(200, { ...food, totalAmount: 0.3 });
    await request(server)
      .post(`/categories/${transport.id}/amounts`)
      .send({ amount: 1.01 })
      .expect(200, { ...transport, totalAmount: 1.01 });

    await request(server)
      .get('/categories')
      .expect(200, [
        { ...food, totalAmount: 0.3 },
        { ...transport, totalAmount: 1.01 },
      ]);
  });

  it('counts each repeated add request as additional spending', async () => {
    const category = await createCategory();

    for (const totalAmount of [12.5, 25]) {
      await request(server)
        .post(`/categories/${category.id}/amounts`)
        .send({ amount: 12.5 })
        .expect(200, { ...category, totalAmount });
    }
  });

  it('rejects duplicate names after trimming and ignoring case', async () => {
    const category = await createCategory();

    await request(server)
      .post('/categories')
      .send({ name: '  fOoD  ' })
      .expect(409);
    await request(server).get('/categories').expect(200, [category]);
  });

  it('persists categories and totals after recreating the application', async () => {
    const category = await createCategory();
    await request(server)
      .post(`/categories/${category.id}/amounts`)
      .send({ amount: 12.5 })
      .expect(200);

    await app.close();
    app = await createApplication();
    server = app.getHttpServer() as Server;

    await request(server)
      .get('/categories')
      .expect(200, [{ ...category, totalAmount: 12.5 }]);
  });

  it('accumulates concurrent requests across application instances without lost updates', async () => {
    const category = await createCategory();
    const secondApp = await createApplication();

    try {
      const secondServer = secondApp.getHttpServer() as Server;
      await Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          request(index % 2 === 0 ? server : secondServer)
            .post(`/categories/${category.id}/amounts`)
            .send({ amount: 0.01 })
            .expect(200),
        ),
      );
      await request(secondServer)
        .get('/categories')
        .expect(200, [{ ...category, totalAmount: 0.2 }]);
    } finally {
      await secondApp.close();
    }
  });

  it('enforces the total limit during concurrent additions', async () => {
    const category = await createCategory();
    await request(server)
      .post(`/categories/${category.id}/amounts`)
      .send({ amount: MAX_CATEGORY_TOTAL - 0.01 })
      .expect(200);

    const responses = await Promise.all(
      Array.from({ length: 2 }, () =>
        request(server)
          .post(`/categories/${category.id}/amounts`)
          .send({ amount: 0.01 }),
      ),
    );

    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 400,
    ]);
    await request(server)
      .get('/categories')
      .expect(200, [{ ...category, totalAmount: MAX_CATEGORY_TOTAL }]);
  });

  it('enforces case-insensitive uniqueness during concurrent category creation', async () => {
    const responses = await Promise.all(
      ['Food', 'fOoD'].map((name) =>
        request(server).post('/categories').send({ name }),
      ),
    );

    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);
    const response = await request(server).get('/categories').expect(200);
    expect(response.body).toHaveLength(1);
  });

  it.each(['-0.01', '1000000000.01'])(
    'enforces the database total constraint for %s',
    async (total) => {
      await expect(
        database.query(
          'INSERT INTO "categories" ("name", "total_amount") VALUES ($1, $2)',
          ['Invalid total', total],
        ),
      ).rejects.toMatchObject({
        driverError: {
          code: '23514',
          constraint: 'chk_categories_total_amount_range',
        },
      });
    },
  );

  it.each(['', '   ', ' Food '])(
    'enforces the database name constraint for "%s"',
    async (name) => {
      await expect(
        database.query('INSERT INTO "categories" ("name") VALUES ($1)', [name]),
      ).rejects.toMatchObject({
        driverError: {
          code: '23514',
          constraint: 'chk_categories_name_trimmed',
        },
      });
    },
  );

  it.each([
    ['missing', {}],
    ['empty', { name: '' }],
    ['whitespace only', { name: '   ' }],
    ['non-string', { name: 123 }],
    ['null', { name: null }],
    ['too long', { name: 'a'.repeat(101) }],
    ['unexpected field', { name: 'Food', totalAmount: 100 }],
  ])('rejects a %s category name or payload', async (_label, body) => {
    await request(server).post('/categories').send(body).expect(400);
    await request(server).get('/categories').expect(200, []);
  });

  it.each([
    ['missing', {}],
    ['zero', { amount: 0 }],
    ['negative', { amount: -1 }],
    ['fractional cent', { amount: 0.001 }],
    ['string', { amount: '12.50' }],
    ['null', { amount: null }],
    ['too large', { amount: MAX_CATEGORY_TOTAL + 1 }],
    ['unexpected field', { amount: 1, note: 'Lunch' }],
  ])(
    'rejects a %s amount or payload without changing the total',
    async (_label, body) => {
      const category = await createCategory();

      await request(server)
        .post(`/categories/${category.id}/amounts`)
        .send(body)
        .expect(400);
      await request(server).get('/categories').expect(200, [category]);
    },
  );

  it('returns 404 for a missing category and 400 for a malformed UUID', async () => {
    await request(server)
      .post(`/categories/${randomUUID()}/amounts`)
      .send({ amount: 10 })
      .expect(404);
    await request(server)
      .post('/categories/not-a-uuid/amounts')
      .send({ amount: 10 })
      .expect(400);
  });

  it('rejects total overflow without modifying the category', async () => {
    const category = await createCategory();

    await request(server)
      .post(`/categories/${category.id}/amounts`)
      .send({ amount: MAX_CATEGORY_TOTAL })
      .expect(200, { ...category, totalAmount: MAX_CATEGORY_TOTAL });
    await request(server)
      .post(`/categories/${category.id}/amounts`)
      .send({ amount: 0.01 })
      .expect(400);
    await request(server)
      .get('/categories')
      .expect(200, [{ ...category, totalAmount: MAX_CATEGORY_TOTAL }]);
  });

  it('serves Swagger UI and documents exactly the three business routes', async () => {
    await request(server)
      .get('/docs')
      .expect(200)
      .expect('Content-Type', /html/);

    const response = await request(server).get('/docs-json').expect(200);
    const document = response.body as OpenAPIObject;

    expect(Object.keys(document.paths).sort()).toEqual([
      '/categories',
      '/categories/{id}/amounts',
    ]);
    expect(Object.keys(document.paths['/categories']).sort()).toEqual([
      'get',
      'post',
    ]);
    expect(Object.keys(document.paths['/categories/{id}/amounts'])).toEqual([
      'post',
    ]);
    expect(document.paths['/categories'].post?.requestBody).toBeDefined();
    expect(
      document.paths['/categories/{id}/amounts'].post?.requestBody,
    ).toBeDefined();
    expect(
      Object.keys(document.paths['/categories'].post!.responses).sort(),
    ).toEqual(['201', '400', '409']);
    expect(
      Object.keys(
        document.paths['/categories/{id}/amounts'].post!.responses,
      ).sort(),
    ).toEqual(['200', '400', '404']);
    expect(document.paths['/categories'].get?.responses['200']).toBeDefined();
  });
});
