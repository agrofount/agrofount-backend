import { MigrationInterface, QueryRunner } from 'typeorm';

export class NotificationCampaign1782310000000 implements MigrationInterface {
  name = 'NotificationCampaign1782310000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."campaign_category_enum" AS ENUM (
          'announcement', 'promotional', 'educational', 'reminder', 'transactional'
        );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."campaign_status_enum" AS ENUM (
          'draft', 'scheduled', 'sending', 'sent', 'failed'
        );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."campaign_frequency_enum" AS ENUM (
          'once', 'daily', 'weekly', 'monthly'
        );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "notification_campaign" (
        "id"               uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "title"            varchar       NOT NULL,
        "message"          text          NOT NULL,
        "category"         "public"."campaign_category_enum" NOT NULL DEFAULT 'announcement',
        "channels"         text          NOT NULL,
        "audience"         jsonb         NOT NULL DEFAULT '{"all":true}',
        "ctaText"          varchar,
        "ctaLink"          varchar,
        "bannerImageUrl"   varchar,
        "emailContent"     text,
        "status"           "public"."campaign_status_enum" NOT NULL DEFAULT 'draft',
        "scheduledAt"      TIMESTAMP,
        "frequency"        "public"."campaign_frequency_enum",
        "totalRecipients"  integer       NOT NULL DEFAULT 0,
        "totalSent"        integer       NOT NULL DEFAULT 0,
        "totalDelivered"   integer       NOT NULL DEFAULT 0,
        "totalFailed"      integer       NOT NULL DEFAULT 0,
        "createdBy"        varchar,
        "createdAt"        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt"        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_notification_campaign" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_notification_campaign_status"
      ON "notification_campaign" ("status")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_notification_campaign_scheduled"
      ON "notification_campaign" ("scheduledAt")
      WHERE "scheduledAt" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_notification_campaign_scheduled"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_notification_campaign_status"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "notification_campaign"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."campaign_frequency_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."campaign_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."campaign_category_enum"`,
    );
  }
}
