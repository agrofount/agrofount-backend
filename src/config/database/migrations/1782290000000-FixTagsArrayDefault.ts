import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixTagsArrayDefault1782290000000 implements MigrationInterface {
  name = 'FixTagsArrayDefault1782290000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ai_knowledge_chunk" ALTER COLUMN "tags" SET DEFAULT '{}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_knowledge_document" ALTER COLUMN "tags" SET DEFAULT '{}'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ai_knowledge_document" ALTER COLUMN "tags" SET DEFAULT ARRAY[]::text[]`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_knowledge_chunk" ALTER COLUMN "tags" SET DEFAULT ARRAY[]::text[]`,
    );
  }
}
