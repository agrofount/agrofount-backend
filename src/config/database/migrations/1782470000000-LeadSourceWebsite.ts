import { MigrationInterface, QueryRunner } from 'typeorm';

export class LeadSourceWebsite1782470000000 implements MigrationInterface {
  name = 'LeadSourceWebsite1782470000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "public"."leads_source_enum" ADD VALUE IF NOT EXISTS 'website'
    `);
  }

  public async down(): Promise<void> {
    // PostgreSQL does not support removing a value from an enum type.
    // Rolling back would require recreating the type and table, which risks
    // data loss for any lead already using the 'website' source — left as a
    // manual, deliberate operation rather than an automatic down migration.
  }
}
