import { MigrationInterface, QueryRunner } from 'typeorm';

/** Adds scheduled publishing to blog posts. Additive only, no data changes. */
export class BlogPostScheduling1782610000000 implements MigrationInterface {
  name = 'BlogPostScheduling1782610000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('posts'))) return;
    await queryRunner.query(`
      ALTER TABLE "posts"
      ADD COLUMN IF NOT EXISTS "scheduledAt" TIMESTAMP,
      ADD COLUMN IF NOT EXISTS "scheduledById" character varying
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('posts'))) return;
    await queryRunner.query(`
      ALTER TABLE "posts"
      DROP COLUMN IF EXISTS "scheduledById",
      DROP COLUMN IF EXISTS "scheduledAt"
    `);
  }
}
