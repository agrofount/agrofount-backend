import { MigrationInterface, QueryRunner } from 'typeorm';

export class PaymentSelectedBankAccount1782000000000
  implements MigrationInterface
{
  name = 'PaymentSelectedBankAccount1782000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('payments'))) {
      return;
    }

    await queryRunner.query(`
      ALTER TABLE "payments"
      ADD COLUMN IF NOT EXISTS "selectedBankAccount" jsonb NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('payments'))) {
      return;
    }

    await queryRunner.query(`
      ALTER TABLE "payments"
      DROP COLUMN IF EXISTS "selectedBankAccount"
    `);
  }
}
