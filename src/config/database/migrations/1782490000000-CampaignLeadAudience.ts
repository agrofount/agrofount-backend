import { MigrationInterface, QueryRunner } from 'typeorm';

export class CampaignLeadAudience1782490000000 implements MigrationInterface {
  name = 'CampaignLeadAudience1782490000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."notification_campaign_audiencetype_enum" AS ENUM ('users', 'leads');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      ALTER TABLE "notification_campaign"
      ADD COLUMN IF NOT EXISTS "audienceType" "public"."notification_campaign_audiencetype_enum" NOT NULL DEFAULT 'users'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "notification_campaign" DROP COLUMN IF EXISTS "audienceType"
    `);
    await queryRunner.query(`
      DROP TYPE IF EXISTS "public"."notification_campaign_audiencetype_enum"
    `);
  }
}
