import { MigrationInterface, QueryRunner } from 'typeorm';

export class UserTokenVersion1782050000000 implements MigrationInterface {
  name = 'UserTokenVersion1782050000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('user'))) {
      return;
    }

    await queryRunner.query(`
      ALTER TABLE "user"
      ADD COLUMN IF NOT EXISTS "tokenVersion" integer NOT NULL DEFAULT 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('user'))) {
      return;
    }

    await queryRunner.query(`
      ALTER TABLE "user"
      DROP COLUMN IF EXISTS "tokenVersion"
    `);
  }
}
