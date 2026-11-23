import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCategories1795046400000 implements MigrationInterface {
  name = 'CreateCategories1795046400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "categories" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" varchar(100) NOT NULL,
        "total_amount" numeric(12,2) NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_categories" PRIMARY KEY ("id"),
        CONSTRAINT "chk_categories_name_trimmed"
          CHECK (char_length(btrim("name")) > 0 AND "name" = btrim("name")),
        CONSTRAINT "chk_categories_total_amount_range"
          CHECK ("total_amount" >= 0 AND "total_amount" <= 1000000000)
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_categories_name_lower"
      ON "categories" (LOWER("name"))
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_categories_created_at_id"
      ON "categories" ("created_at", "id")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "categories"');
  }
}
