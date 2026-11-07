import { MigrationInterface, QueryRunner } from 'typeorm';

/** Adds the optional NIPOST postcode to the user profile. Additive only. */
export class UserPostcode1793500000000 implements MigrationInterface {
  name = 'UserPostcode1793500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "postcode" character varying(11)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" DROP COLUMN IF EXISTS "postcode"`,
    );
  }
}
