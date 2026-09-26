import { MigrationInterface, QueryRunner } from 'typeorm';

export class MessageLeadPhoneIndex1782540000000 implements MigrationInterface {
  name = 'MessageLeadPhoneIndex1782540000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "message"
      ADD COLUMN IF NOT EXISTS "normalizedPhone" varchar
      GENERATED ALWAYS AS (
        CASE
          WHEN "recipientPhone" IS NULL OR "recipientPhone" = '' THEN NULL
          ELSE regexp_replace(regexp_replace("recipientPhone", '[^0-9]', '', 'g'), '^0', '234')
        END
      ) STORED
    `);

    await queryRunner.query(`
      ALTER TABLE "leads"
      ADD COLUMN IF NOT EXISTS "normalizedPhone" varchar
      GENERATED ALWAYS AS (
        CASE
          WHEN "phone" IS NULL OR "phone" = '' THEN NULL
          ELSE regexp_replace(regexp_replace("phone", '[^0-9]', '', 'g'), '^0', '234')
        END
      ) STORED
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_message_normalized_phone"
      ON "message" ("normalizedPhone")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_message_user_id"
      ON "message" ("userId")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_leads_normalized_phone"
      ON "leads" ("normalizedPhone")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_message_channel_status_type"
      ON "message" ("channel", "status", "messageType")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_message_channel_status_type"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_leads_normalized_phone"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_message_user_id"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_message_normalized_phone"`,
    );

    await queryRunner.query(`
      ALTER TABLE "leads"
      DROP COLUMN IF EXISTS "normalizedPhone"
    `);

    await queryRunner.query(`
      ALTER TABLE "message"
      DROP COLUMN IF EXISTS "normalizedPhone"
    `);
  }
}
