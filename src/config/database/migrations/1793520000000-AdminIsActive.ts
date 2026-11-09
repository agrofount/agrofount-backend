import { MigrationInterface, QueryRunner } from 'typeorm';

/** Lets an admin be deactivated without deleting them. Additive, defaults to active. */
export class AdminIsActive1793520000000 implements MigrationInterface {
  name = 'AdminIsActive1793520000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Admin" ADD COLUMN IF NOT EXISTS "isActive" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Admin" DROP COLUMN IF EXISTS "isActive"`,
    );
  }
}
