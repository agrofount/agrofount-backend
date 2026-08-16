import { MigrationInterface, QueryRunner } from 'typeorm';

export class WalletMinorAmounts1782440000000 implements MigrationInterface {
  name = 'WalletMinorAmounts1782440000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "wallet"
      ADD COLUMN IF NOT EXISTS "balanceMinor" bigint,
      ADD COLUMN IF NOT EXISTS "borrowedAmountMinor" bigint
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "wallet"
      DROP COLUMN IF EXISTS "borrowedAmountMinor",
      DROP COLUMN IF EXISTS "balanceMinor"
    `);
  }
}
