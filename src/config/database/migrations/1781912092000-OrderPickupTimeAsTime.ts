import { MigrationInterface, QueryRunner } from 'typeorm';

export class OrderPickupTimeAsTime1781912092000 implements MigrationInterface {
  name = 'OrderPickupTimeAsTime1781912092000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('orders'))) {
      return;
    }

    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "pickupTime" time without time zone NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
      ALTER COLUMN "pickupTime" TYPE time without time zone
      USING "pickupTime"::time
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('orders'))) {
      return;
    }

    await queryRunner.query(`
      ALTER TABLE "orders"
      ALTER COLUMN "pickupTime" TYPE timestamp without time zone
      USING (CURRENT_DATE + "pickupTime")::timestamp without time zone
    `);
  }
}
