import { MigrationInterface, QueryRunner } from 'typeorm';

export class OrderPendingReminderSentAt1782510000000
  implements MigrationInterface
{
  name = 'OrderPendingReminderSentAt1782510000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "pendingReminderSentAt" timestamp
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_orders_pending_reminder_sent_at"
      ON "orders" ("pendingReminderSentAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_orders_pending_reminder_sent_at"`,
    );

    await queryRunner.query(`
      ALTER TABLE "orders"
      DROP COLUMN IF EXISTS "pendingReminderSentAt"
    `);
  }
}
