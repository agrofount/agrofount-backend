import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Blog posts could never be activated: `isActive` defaults to false and no
 * endpoint set it, so every post showed as inactive in the admin. Mark the
 * posts the public site already shows (published ones) as active. Drafts
 * stay inactive.
 */
export class BackfillBlogPostActive1782600000000 implements MigrationInterface {
  name = 'BackfillBlogPostActive1782600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('posts'))) return;
    await queryRunner.query(`
      UPDATE "posts" SET "isActive" = true
      WHERE "published" = true
        AND "isActive" = false
        AND "deletedAt" IS NULL
    `);
  }

  public async down(): Promise<void> {
    // Not reversible: the rows that were already active before this ran
    // cannot be told apart from the ones it changed.
  }
}
