import { MigrationInterface, QueryRunner } from 'typeorm';

export class HybridRagSearch1782320000000 implements MigrationInterface {
  name = 'HybridRagSearch1782320000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector`);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_knowledge_chunk_fts"
      ON "ai_knowledge_chunk" USING gin (to_tsvector('english', content))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_ai_knowledge_chunk_fts"`,
    );
  }
}
