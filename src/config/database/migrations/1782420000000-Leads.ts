import { MigrationInterface, QueryRunner } from 'typeorm';

export class Leads1782420000000 implements MigrationInterface {
  name = 'Leads1782420000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."leads_source_enum" AS ENUM ('meta', 'manual', 'other');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."leads_status_enum" AS ENUM (
          'new', 'contacted', 'qualified', 'converted', 'rejected'
        );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "leads" (
        "id"              uuid NOT NULL DEFAULT uuid_generate_v4(),
        "sourceLeadId"    varchar,
        "name"            varchar NOT NULL,
        "phone"           varchar NOT NULL,
        "email"           varchar,
        "gender"          varchar,
        "state"           varchar,
        "source"          "public"."leads_source_enum" NOT NULL DEFAULT 'meta',
        "adId"            varchar,
        "adName"          varchar,
        "campaignId"      varchar,
        "campaignName"    varchar,
        "formId"          varchar,
        "formName"        varchar,
        "status"          "public"."leads_status_enum" NOT NULL DEFAULT 'new',
        "notes"           text,
        "convertedUserId" varchar,
        "managedBy"       varchar,
        "sourceCreatedAt" TIMESTAMP,
        "contactedAt"     TIMESTAMP,
        "convertedAt"     TIMESTAMP,
        "createdAt"       TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"       TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt"       TIMESTAMP,
        CONSTRAINT "PK_leads" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_leads_source_lead_id"
      ON "leads" ("sourceLeadId")
      WHERE "sourceLeadId" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_leads_phone"
      ON "leads" ("phone")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_leads_status"
      ON "leads" ("status")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_leads_created_at"
      ON "leads" ("createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_leads_created_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_leads_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_leads_phone"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_leads_source_lead_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "leads"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."leads_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."leads_source_enum"`);
  }
}
