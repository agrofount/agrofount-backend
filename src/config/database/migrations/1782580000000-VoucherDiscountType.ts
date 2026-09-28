import { MigrationInterface, QueryRunner } from 'typeorm';

export class VoucherDiscountType1782580000000 implements MigrationInterface {
  name = 'VoucherDiscountType1782580000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "voucher"
      ADD COLUMN IF NOT EXISTS "discountType" varchar(10) NOT NULL DEFAULT 'fixed'
    `);

    await queryRunner.query(`
      ALTER TABLE "voucher"
      ADD CONSTRAINT "CHK_voucher_discount_type" CHECK ("discountType" IN ('fixed', 'percentage'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "voucher" DROP CONSTRAINT IF EXISTS "CHK_voucher_discount_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "voucher" DROP COLUMN IF EXISTS "discountType"`,
    );
  }
}
