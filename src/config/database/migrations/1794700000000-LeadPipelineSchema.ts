import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lead pipeline: stage, buyer profile, handover SLA, follow-up, and the
 * append-only stage history, ownership history and activity tables.
 * Existing columns (including status) are untouched.
 */
export class LeadPipelineSchema1794700000000 implements MigrationInterface {
  name = 'LeadPipelineSchema1794700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // New lead sources. 'website' (website sign-up) already exists.
    for (const value of [
      'field_visit',
      'referral',
      'cs_social',
      'whatsapp',
      'phone_call',
      'ayo_web_chat',
      'event_market',
      'partner',
    ]) {
      await queryRunner.query(
        `ALTER TYPE "public"."leads_source_enum" ADD VALUE IF NOT EXISTS '${value}'`,
      );
    }

    await queryRunner.query(
      `CREATE TYPE "public"."leads_stage_enum" AS ENUM('new', 'contacted', 'visited', 'quoted', 'ordered_paid', 'lost')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."leads_lostreason_enum" AS ENUM('price', 'no_stock', 'timing', 'competitor', 'unreachable', 'other')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."leads_buyertype_enum" AS ENUM('smallholder', 'commercial_farm', 'cooperative', 'agro_dealer', 'institution')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."leads_productinterest_enum" AS ENUM('day_old_chicks', 'feed', 'medication_vaccines', 'other_inputs', 'mixed')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."leads_farmsizeunit_enum" AS ENUM('birds', 'fish', 'hectares')`,
    );

    await queryRunner.query(`
      ALTER TABLE "leads"
        ADD "stage" "public"."leads_stage_enum" NOT NULL DEFAULT 'new',
        ADD "lostReason" "public"."leads_lostreason_enum",
        ADD "contactPerson" character varying,
        ADD "townOrLga" character varying,
        ADD "stateId" uuid,
        ADD "buyerType" "public"."leads_buyertype_enum",
        ADD "productInterest" "public"."leads_productinterest_enum",
        ADD "farmSize" numeric(12,2),
        ADD "farmSizeUnit" "public"."leads_farmsizeunit_enum",
        ADD "estimatedOrderValueKobo" bigint,
        ADD "sourceDetail" character varying,
        ADD "partnerName" character varying,
        ADD "createdById" uuid,
        ADD "handedOverAt" TIMESTAMP WITH TIME ZONE,
        ADD "slaWarnedAt" TIMESTAMP WITH TIME ZONE,
        ADD "slaBreachedAt" TIMESTAMP WITH TIME ZONE,
        ADD "nextAction" character varying(255),
        ADD "nextActionAt" TIMESTAMP WITH TIME ZONE,
        ADD "lastActivityAt" TIMESTAMP WITH TIME ZONE,
        ADD "anonymisedAt" TIMESTAMP WITH TIME ZONE
    `);

    // Map the existing status onto the new stage. "Ordered and paid" is
    // not backfilled here: only the payment hook may set it.
    await queryRunner.query(`
      UPDATE "leads" SET "stage" = CASE "status"
        WHEN 'new' THEN 'new'
        WHEN 'rejected' THEN 'lost'
        ELSE 'contacted'
      END::"public"."leads_stage_enum"
    `);
    await queryRunner.query(
      `UPDATE "leads" SET "lostReason" = 'other' WHERE "status" = 'rejected'`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_LEAD_OWNER_STAGE" ON "leads" ("ownerId", "stage")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_LEAD_NEXT_ACTION_AT" ON "leads" ("nextActionAt") WHERE "nextActionAt" IS NOT NULL`,
    );
    // Phone lookups for de-duplication use the generated normalizedPhone.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_leads_normalized_phone" ON "leads" ("normalizedPhone")`,
    );

    // Stage history (append-only).
    await queryRunner.query(
      `CREATE TYPE "public"."lead_stage_history_fromstage_enum" AS ENUM('new', 'contacted', 'visited', 'quoted', 'ordered_paid', 'lost')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."lead_stage_history_tostage_enum" AS ENUM('new', 'contacted', 'visited', 'quoted', 'ordered_paid', 'lost')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."lead_stage_history_actortype_enum" AS ENUM('admin', 'system')`,
    );
    await queryRunner.query(`
      CREATE TABLE "lead_stage_history" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "leadId" uuid NOT NULL,
        "fromStage" "public"."lead_stage_history_fromstage_enum",
        "toStage" "public"."lead_stage_history_tostage_enum" NOT NULL,
        "actorId" uuid,
        "actorType" "public"."lead_stage_history_actortype_enum" NOT NULL DEFAULT 'admin',
        "note" text,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lead_stage_history" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_LEAD_STAGE_HISTORY_LEAD" ON "lead_stage_history" ("leadId", "createdAt")`,
    );
    await queryRunner.query(`
      CREATE FUNCTION "lead_stage_history_append_only"() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'lead_stage_history is append-only';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "lead_stage_history_append_only"
      BEFORE UPDATE OR DELETE ON "lead_stage_history"
      FOR EACH ROW EXECUTE FUNCTION "lead_stage_history_append_only"()
    `);

    // Ownership history.
    await queryRunner.query(`
      CREATE TABLE "lead_owner_history" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "leadId" uuid NOT NULL,
        "fromOwnerId" uuid,
        "toOwnerId" uuid,
        "actorId" uuid NOT NULL,
        "reason" text,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lead_owner_history" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_LEAD_OWNER_HISTORY_LEAD" ON "lead_owner_history" ("leadId", "createdAt")`,
    );

    // Activities.
    await queryRunner.query(
      `CREATE TYPE "public"."lead_activities_type_enum" AS ENUM('call', 'whatsapp', 'visit', 'quote', 'note')`,
    );
    await queryRunner.query(`
      CREATE TABLE "lead_activities" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "leadId" uuid NOT NULL,
        "authorId" uuid NOT NULL,
        "type" "public"."lead_activities_type_enum" NOT NULL,
        "summary" text,
        "latitude" numeric(9,6),
        "longitude" numeric(9,6),
        "photoKey" character varying,
        "quoteAmountKobo" bigint,
        "nextAction" character varying(255),
        "nextActionAt" TIMESTAMP WITH TIME ZONE,
        "occurredAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "idempotencyKey" character varying(100),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lead_activities" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_LEAD_ACTIVITY_LEAD" ON "lead_activities" ("leadId", "occurredAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_LEAD_ACTIVITY_AUTHOR" ON "lead_activities" ("authorId", "type", "occurredAt")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_LEAD_ACTIVITY_IDEMPOTENCY" ON "lead_activities" ("authorId", "idempotencyKey") WHERE "idempotencyKey" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "lead_activities"`);
    await queryRunner.query(`DROP TYPE "public"."lead_activities_type_enum"`);
    await queryRunner.query(`DROP TABLE "lead_owner_history"`);
    await queryRunner.query(
      `DROP TRIGGER "lead_stage_history_append_only" ON "lead_stage_history"`,
    );
    await queryRunner.query(`DROP FUNCTION "lead_stage_history_append_only"()`);
    await queryRunner.query(`DROP TABLE "lead_stage_history"`);
    await queryRunner.query(
      `DROP TYPE "public"."lead_stage_history_actortype_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."lead_stage_history_tostage_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."lead_stage_history_fromstage_enum"`,
    );

    await queryRunner.query(`DROP INDEX "public"."IDX_leads_normalized_phone"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_LEAD_NEXT_ACTION_AT"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_LEAD_OWNER_STAGE"`);
    await queryRunner.query(`
      ALTER TABLE "leads"
        DROP COLUMN "anonymisedAt",
        DROP COLUMN "lastActivityAt",
        DROP COLUMN "nextActionAt",
        DROP COLUMN "nextAction",
        DROP COLUMN "slaBreachedAt",
        DROP COLUMN "slaWarnedAt",
        DROP COLUMN "handedOverAt",
        DROP COLUMN "createdById",
        DROP COLUMN "partnerName",
        DROP COLUMN "sourceDetail",
        DROP COLUMN "estimatedOrderValueKobo",
        DROP COLUMN "farmSizeUnit",
        DROP COLUMN "farmSize",
        DROP COLUMN "productInterest",
        DROP COLUMN "buyerType",
        DROP COLUMN "stateId",
        DROP COLUMN "townOrLga",
        DROP COLUMN "contactPerson",
        DROP COLUMN "lostReason",
        DROP COLUMN "stage"
    `);
    await queryRunner.query(`DROP TYPE "public"."leads_farmsizeunit_enum"`);
    await queryRunner.query(`DROP TYPE "public"."leads_productinterest_enum"`);
    await queryRunner.query(`DROP TYPE "public"."leads_buyertype_enum"`);
    await queryRunner.query(`DROP TYPE "public"."leads_lostreason_enum"`);
    await queryRunner.query(`DROP TYPE "public"."leads_stage_enum"`);

    // Postgres cannot drop enum values, so rebuild the source type without
    // the new ones. Leads using them fall back to 'other'.
    await queryRunner.query(`
      UPDATE "leads" SET "source" = 'other'
      WHERE "source"::text IN ('field_visit', 'referral', 'cs_social', 'whatsapp', 'phone_call', 'ayo_web_chat', 'event_market', 'partner')
    `);
    await queryRunner.query(
      `ALTER TABLE "leads" ALTER COLUMN "source" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."leads_source_enum" RENAME TO "leads_source_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."leads_source_enum" AS ENUM('meta', 'manual', 'other', 'website')`,
    );
    await queryRunner.query(
      `ALTER TABLE "leads" ALTER COLUMN "source" TYPE "public"."leads_source_enum" USING "source"::text::"public"."leads_source_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "leads" ALTER COLUMN "source" SET DEFAULT 'meta'`,
    );
    await queryRunner.query(`DROP TYPE "public"."leads_source_enum_old"`);
  }
}
