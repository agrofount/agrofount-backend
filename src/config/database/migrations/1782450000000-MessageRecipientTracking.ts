import { MigrationInterface, QueryRunner } from 'typeorm';

export class MessageRecipientTracking1782450000000
  implements MigrationInterface
{
  name = 'MessageRecipientTracking1782450000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "message"
      ADD COLUMN IF NOT EXISTS "campaignId" varchar,
      ADD COLUMN IF NOT EXISTS "jobName" varchar,
      ADD COLUMN IF NOT EXISTS "channel" varchar,
      ADD COLUMN IF NOT EXISTS "status" varchar NOT NULL DEFAULT 'SENT',
      ADD COLUMN IF NOT EXISTS "errorMessage" text,
      ADD COLUMN IF NOT EXISTS "recipientEmail" varchar,
      ADD COLUMN IF NOT EXISTS "recipientPhone" varchar
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_message_campaign_id"
      ON "message" ("campaignId")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_message_job_name"
      ON "message" ("jobName")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_message_status"
      ON "message" ("status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_message_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_message_job_name"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_message_campaign_id"`);

    await queryRunner.query(`
      ALTER TABLE "message"
      DROP COLUMN IF EXISTS "recipientPhone",
      DROP COLUMN IF EXISTS "recipientEmail",
      DROP COLUMN IF EXISTS "errorMessage",
      DROP COLUMN IF EXISTS "status",
      DROP COLUMN IF EXISTS "channel",
      DROP COLUMN IF EXISTS "jobName",
      DROP COLUMN IF EXISTS "campaignId"
    `);
  }
}
