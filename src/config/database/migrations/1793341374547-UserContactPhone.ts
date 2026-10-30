import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the optional, unverified contact number given at email sign-up.
 * Additive only: a nullable column and its unique constraint.
 */
export class UserContactPhone1793341374547 implements MigrationInterface {
  name = 'UserContactPhone1793341374547';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "contactPhone" character varying`,
    );
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'UQ_7bfe946efbc897d130b7db8f26b'
        ) THEN
          ALTER TABLE "user"
            ADD CONSTRAINT "UQ_7bfe946efbc897d130b7db8f26b" UNIQUE ("contactPhone");
        END IF;
      END $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" DROP CONSTRAINT IF EXISTS "UQ_7bfe946efbc897d130b7db8f26b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" DROP COLUMN IF EXISTS "contactPhone"`,
    );
  }
}
