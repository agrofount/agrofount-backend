import { MigrationInterface, QueryRunner } from 'typeorm';

export class MessageFailureCategory1782500000000 implements MigrationInterface {
  name = 'MessageFailureCategory1782500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "message"
      ADD COLUMN IF NOT EXISTS "failureCategory" varchar
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_message_failure_category"
      ON "message" ("failureCategory")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_message_failure_category"`,
    );

    await queryRunner.query(`
      ALTER TABLE "message"
      DROP COLUMN IF EXISTS "failureCategory"
    `);
  }
}
