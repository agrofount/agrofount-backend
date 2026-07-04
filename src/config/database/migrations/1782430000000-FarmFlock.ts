import { MigrationInterface, QueryRunner } from 'typeorm';

export class FarmFlock1782430000000 implements MigrationInterface {
  name = 'FarmFlock1782430000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."farm_flocks_status_enum" AS ENUM ('active', 'completed');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "farm_flocks" (
        "id"        uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId"    uuid NOT NULL,
        "birdType"  character varying(80) NOT NULL,
        "quantity"  integer NOT NULL,
        "startDate" date NOT NULL,
        "status"    "public"."farm_flocks_status_enum" NOT NULL DEFAULT 'active',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        CONSTRAINT "PK_farm_flocks" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_farm_flocks_user_status"
      ON "farm_flocks" ("userId", "status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_farm_flocks_user_status"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "farm_flocks"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."farm_flocks_status_enum"`,
    );
  }
}
