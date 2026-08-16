import { MigrationInterface, QueryRunner } from 'typeorm';

export class AiUserQuota1782410000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "ai_user_quota" (
        "id"           uuid                        NOT NULL DEFAULT uuid_generate_v4(),
        "userId"       character varying           NOT NULL,
        "bonusTokens"  integer                     NOT NULL DEFAULT 0,
        "lastResetBy"  character varying,
        "updatedAt"    TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_ai_user_quota_userId" UNIQUE ("userId"),
        CONSTRAINT "PK_ai_user_quota"        PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "ai_user_quota"`);
  }
}
