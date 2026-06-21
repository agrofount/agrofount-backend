import { MigrationInterface, QueryRunner } from 'typeorm';

export class AiSettingsAndFeedback1782080000000 implements MigrationInterface {
  name = 'AiSettingsAndFeedback1782080000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ai_settings" (
        "id"                       integer                     NOT NULL,
        "isActive"                 boolean                     NOT NULL DEFAULT true,
        "provider"                 character varying(80)       NOT NULL DEFAULT 'AWS Bedrock',
        "model"                    character varying(120)      NOT NULL DEFAULT 'amazon.nova-lite-v1:0',
        "monthlyBudgetUSD"         numeric(14,2)                        DEFAULT NULL,
        "costPer1MInputTokensUSD"  numeric(14,6)               NOT NULL,
        "costPer1MOutputTokensUSD" numeric(14,6)               NOT NULL,
        "updatedBy"                uuid                                 DEFAULT NULL,
        "updatedAt"                TIMESTAMP                   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_settings" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      INSERT INTO "ai_settings" ("id", "costPer1MInputTokensUSD", "costPer1MOutputTokensUSD")
      VALUES (1, 0.06, 0.24)
      ON CONFLICT DO NOTHING
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "farm_assistant_feedback" (
        "id"             uuid                  NOT NULL DEFAULT uuid_generate_v4(),
        "conversationId" uuid                  NOT NULL,
        "messageId"      uuid                           DEFAULT NULL,
        "userId"         uuid                  NOT NULL,
        "rating"         character varying(20) NOT NULL,
        "createdAt"      TIMESTAMP             NOT NULL DEFAULT now(),
        CONSTRAINT "PK_farm_assistant_feedback" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_farm_assistant_feedback_conversation"
        ON "farm_assistant_feedback" ("conversationId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_farm_assistant_feedback_user"
        ON "farm_assistant_feedback" ("userId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_farm_assistant_feedback_created"
        ON "farm_assistant_feedback" ("createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_farm_assistant_feedback_created"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_farm_assistant_feedback_user"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_farm_assistant_feedback_conversation"',
    );
    await queryRunner.query('DROP TABLE IF EXISTS "farm_assistant_feedback"');
    await queryRunner.query('DROP TABLE IF EXISTS "ai_settings"');
  }
}
