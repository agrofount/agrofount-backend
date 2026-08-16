import { MigrationInterface, QueryRunner } from 'typeorm';

export class SellerInterestInternalNotes1782460000000
  implements MigrationInterface
{
  name = 'SellerInterestInternalNotes1782460000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "seller_interest"
      ADD COLUMN IF NOT EXISTS "internalNotes" text
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "seller_interest"
      DROP COLUMN IF EXISTS "internalNotes"
    `);
  }
}
