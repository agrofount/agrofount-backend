import { MigrationInterface, QueryRunner } from 'typeorm';

export class VoucherLifecycle1782590000000 implements MigrationInterface {
  name = 'VoucherLifecycle1782590000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const existing = await queryRunner.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'voucher'
    `);
    const hadStatus = existing.some(
      (column: { column_name: string }) => column.column_name === 'status',
    );
    await queryRunner.query(`
      ALTER TABLE "voucher"
      ADD COLUMN IF NOT EXISTS "status" varchar(20) NOT NULL DEFAULT 'active',
      ADD COLUMN IF NOT EXISTS "currency" varchar(3) NOT NULL DEFAULT 'NGN',
      ADD COLUMN IF NOT EXISTS "minimumSpend" numeric(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "campaign" varchar(80),
      ADD COLUMN IF NOT EXISTS "expiresAt" timestamptz,
      ADD COLUMN IF NOT EXISTS "redeemedAt" timestamptz,
      ADD COLUMN IF NOT EXISTS "sourceKey" varchar
    `);
    // Do not renew historical vouchers by giving them thirty days from today.
    await queryRunner.query(`
      UPDATE "voucher" SET "expiresAt" = "createdAt" + INTERVAL '30 days'
      WHERE "expiresAt" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "voucher"
      ALTER COLUMN "expiresAt" SET DEFAULT CURRENT_TIMESTAMP + INTERVAL '30 days',
      ALTER COLUMN "expiresAt" SET NOT NULL
    `);
    if (!hadStatus) {
      await queryRunner.query(`
        UPDATE "voucher" SET "status" = CASE
          WHEN "used" THEN 'redeemed'
          WHEN "expiresAt" <= CURRENT_TIMESTAMP THEN 'expired'
          ELSE 'active' END
      `);
    }
    const constraint =
      queryRunner.connection.namingStrategy.uniqueConstraintName('voucher', [
        'sourceKey',
      ]);
    const constraints = await queryRunner.query(
      `
      SELECT 1 FROM pg_constraint WHERE conrelid = 'voucher'::regclass AND conname = $1
    `,
      [constraint],
    );
    if (!constraints.length) {
      await queryRunner.query(
        `ALTER TABLE "voucher" ADD CONSTRAINT "${constraint}" UNIQUE ("sourceKey")`,
      );
    }
  }

  public async down(): Promise<void> {
    // Preserve voucher lifecycle and redemption data on application rollback.
  }
}
