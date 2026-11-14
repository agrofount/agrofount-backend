import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-location referral commission, as a percent of the line value. NULL
 * means the platform default applies. Additive only.
 */
export class ProductLocationCommission1793530000000
  implements MigrationInterface
{
  name = 'ProductLocationCommission1793530000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "product_location"
        ADD COLUMN IF NOT EXISTS "commissionRate" numeric(5,2)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "product_location"
        DROP COLUMN IF EXISTS "commissionRate"
    `);
  }
}
