import { MigrationInterface, QueryRunner } from 'typeorm';

export class LeadCustomFields1782480000000 implements MigrationInterface {
  name = 'LeadCustomFields1782480000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "customFields" jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "leads" DROP COLUMN IF EXISTS "customFields"
    `);
  }
}
