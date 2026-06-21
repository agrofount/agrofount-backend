import { MigrationInterface, QueryRunner } from 'typeorm';

export class AiPlatformFoundation1782090000000 implements MigrationInterface {
  name = 'AiPlatformFoundation1782090000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ai_knowledge_document" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "sourceType" character varying(40) NOT NULL,
        "title" character varying(220) NOT NULL,
        "body" text NOT NULL,
        "metadata" jsonb NOT NULL DEFAULT '{}',
        "tags" text[] NOT NULL DEFAULT ARRAY[]::text[],
        "externalId" character varying(80),
        "checksum" character varying(64) NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'active',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_knowledge_document" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_ai_knowledge_document_checksum"
      ON "ai_knowledge_document" ("checksum")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_knowledge_document_source_status"
      ON "ai_knowledge_document" ("sourceType", "status")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ai_knowledge_chunk" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "documentId" uuid NOT NULL,
        "sourceType" character varying(40) NOT NULL,
        "chunkIndex" integer NOT NULL,
        "content" text NOT NULL,
        "metadata" jsonb NOT NULL DEFAULT '{}',
        "tags" text[] NOT NULL DEFAULT ARRAY[]::text[],
        "tokenEstimate" integer NOT NULL DEFAULT 0,
        "embedding" jsonb,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_knowledge_chunk" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_knowledge_chunk_document"
      ON "ai_knowledge_chunk" ("documentId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_knowledge_chunk_source"
      ON "ai_knowledge_chunk" ("sourceType")
    `);
    await queryRunner
      .query(
        `
      ALTER TABLE "ai_knowledge_chunk"
      ADD CONSTRAINT "FK_ai_knowledge_chunk_document"
      FOREIGN KEY ("documentId") REFERENCES "ai_knowledge_document"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION
    `,
      )
      .catch(() => undefined);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ai_tool_invocation" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "toolName" character varying(120) NOT NULL,
        "userId" uuid,
        "conversationId" uuid,
        "actorType" character varying(40) NOT NULL,
        "status" character varying(20) NOT NULL,
        "inputSummary" jsonb NOT NULL DEFAULT '{}',
        "outputSummary" jsonb,
        "errorMessage" text,
        "latencyMs" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_tool_invocation" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_tool_invocation_tool_created"
      ON "ai_tool_invocation" ("toolName", "createdAt")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_tool_invocation_user_created"
      ON "ai_tool_invocation" ("userId", "createdAt")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ai_workflow_run" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "workflowName" character varying(120) NOT NULL,
        "userId" uuid,
        "conversationId" uuid,
        "status" character varying(20) NOT NULL,
        "inputSummary" jsonb NOT NULL DEFAULT '{}',
        "resultSummary" jsonb,
        "errorMessage" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_workflow_run" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_workflow_run_name_created"
      ON "ai_workflow_run" ("workflowName", "createdAt")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_workflow_run_user_created"
      ON "ai_workflow_run" ("userId", "createdAt")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ai_agent_run" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "agentName" character varying(120) NOT NULL,
        "userId" uuid,
        "conversationId" uuid,
        "status" character varying(20) NOT NULL,
        "inputSummary" jsonb NOT NULL DEFAULT '{}',
        "outputSummary" jsonb,
        "latencyMs" integer,
        "errorMessage" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_agent_run" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_agent_run_agent_created"
      ON "ai_agent_run" ("agentName", "createdAt")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_agent_run_user_created"
      ON "ai_agent_run" ("userId", "createdAt")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ai_rag_query" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid,
        "sourceType" character varying(40),
        "query" text NOT NULL,
        "topK" integer NOT NULL DEFAULT 5,
        "resultChunkIds" jsonb NOT NULL DEFAULT '[]',
        "latencyMs" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_rag_query" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_rag_query_user_created"
      ON "ai_rag_query" ("userId", "createdAt")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_rag_query_source_created"
      ON "ai_rag_query" ("sourceType", "createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_rag_query"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_agent_run"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_workflow_run"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_tool_invocation"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_knowledge_chunk"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_knowledge_document"`);
  }
}
