import { MigrationInterface, QueryRunner } from 'typeorm';

export class OrderPickupTimeAsTime1781912092000 implements MigrationInterface {
  name = 'OrderPickupTimeAsTime1781912092000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'orders' AND column_name = 'pickupTime'
        ) THEN
          ALTER TABLE "orders"
            ALTER COLUMN "pickupTime" TYPE time without time zone
            USING "pickupTime"::time;
        ELSE
          ALTER TABLE "orders"
            ADD COLUMN "pickupTime" time without time zone NULL;
        END IF;
      END $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orders"
      ALTER COLUMN "pickupTime" TYPE timestamp without time zone
      USING (CURRENT_DATE + "pickupTime")::timestamp without time zone
    `);
  }
}
