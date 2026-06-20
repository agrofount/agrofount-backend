import { MigrationInterface, QueryRunner } from 'typeorm';

export class AiFarmAssistant1763420000000 implements MigrationInterface {
  name = 'AiFarmAssistant1763420000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "farm_assistant_conversation" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "title" character varying(160) NOT NULL,
        "farmContext" jsonb,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_farm_assistant_conversation" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "farm_assistant_message" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "conversationId" uuid NOT NULL,
        "role" character varying(20) NOT NULL,
        "content" text NOT NULL,
        "metadata" jsonb,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_farm_assistant_message" PRIMARY KEY ("id"),
        CONSTRAINT "FK_farm_assistant_message_conversation"
          FOREIGN KEY ("conversationId")
          REFERENCES "farm_assistant_conversation"("id")
          ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_farm_assistant_conversation_user"
        ON "farm_assistant_conversation" ("userId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_farm_assistant_conversation_updated"
        ON "farm_assistant_conversation" ("updatedAt")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_farm_assistant_message_conversation"
        ON "farm_assistant_message" ("conversationId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_farm_assistant_message_created"
        ON "farm_assistant_message" ("createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_farm_assistant_message_created"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_farm_assistant_message_conversation"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_farm_assistant_conversation_updated"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_farm_assistant_conversation_user"',
    );
    await queryRunner.query('DROP TABLE IF EXISTS "farm_assistant_message"');
    await queryRunner.query(
      'DROP TABLE IF EXISTS "farm_assistant_conversation"',
    );
  }
}
