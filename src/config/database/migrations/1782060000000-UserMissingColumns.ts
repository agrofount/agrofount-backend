import { MigrationInterface, QueryRunner } from 'typeorm';

export class UserMissingColumns1782060000000 implements MigrationInterface {
  name = 'UserMissingColumns1782060000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user"
      ADD COLUMN IF NOT EXISTS "verificationTokenExpires" timestamp NULL,
      ADD COLUMN IF NOT EXISTS "country" character varying NULL DEFAULT 'Nigeria',
      ADD COLUMN IF NOT EXISTS "state" character varying NULL,
      ADD COLUMN IF NOT EXISTS "city" character varying NULL,
      ADD COLUMN IF NOT EXISTS "gender" character varying NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user"
      DROP COLUMN IF EXISTS "verificationTokenExpires",
      DROP COLUMN IF EXISTS "country",
      DROP COLUMN IF EXISTS "state",
      DROP COLUMN IF EXISTS "city",
      DROP COLUMN IF EXISTS "gender"
    `);
  }
}
