import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Order attribution columns, staff start date and referral code, the
 * commission rate table and per-staff period targets. Existing orders are
 * backfilled as "unattributed" through the column default.
 */
export class AttributionTargetsSchema1794700100000
  implements MigrationInterface
{
  name = 'AttributionTargetsSchema1794700100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."orders_attributionsource_enum" AS ENUM('lead_owner', 'referral_code', 'logged_lead', 'unattributed')`,
    );
    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD "leadId" uuid,
        ADD "attributedAdminId" uuid,
        ADD "attributionSource" "public"."orders_attributionsource_enum" NOT NULL DEFAULT 'unattributed',
        ADD "attributedAt" TIMESTAMP WITH TIME ZONE
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_ORDER_LEAD" ON "orders" ("leadId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ORDER_ATTRIBUTED_ADMIN" ON "orders" ("attributedAdminId")`,
    );

    await queryRunner.query(`
      ALTER TABLE "Admin"
        ADD "startDate" date,
        ADD "referralCode" character varying,
        ADD CONSTRAINT "UQ_admin_referral_code" UNIQUE ("referralCode")
    `);

    await queryRunner.query(`
      CREATE TABLE "commission_rates" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "categoryKey" character varying NOT NULL,
        "rateBps" integer NOT NULL,
        "updatedBy" uuid,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_commission_rates_category" UNIQUE ("categoryKey"),
        CONSTRAINT "CHK_commission_rates_bps" CHECK ("rateBps" >= 0 AND "rateBps" <= 10000),
        CONSTRAINT "PK_commission_rates" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE TYPE "public"."staff_targets_periodtype_enum" AS ENUM('week', 'quarter')`,
    );
    await queryRunner.query(`
      CREATE TABLE "staff_targets" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "adminId" uuid NOT NULL,
        "periodType" "public"."staff_targets_periodtype_enum" NOT NULL,
        "periodStart" date NOT NULL,
        "periodEnd" date NOT NULL,
        "metric" character varying NOT NULL,
        "targetValue" numeric(18,2) NOT NULL,
        "setBy" uuid,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_staff_targets" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_STAFF_TARGET" ON "staff_targets" ("adminId", "periodType", "periodStart", "metric")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "staff_targets"`);
    await queryRunner.query(
      `DROP TYPE "public"."staff_targets_periodtype_enum"`,
    );
    await queryRunner.query(`DROP TABLE "commission_rates"`);
    await queryRunner.query(`
      ALTER TABLE "Admin"
        DROP CONSTRAINT "UQ_admin_referral_code",
        DROP COLUMN "referralCode",
        DROP COLUMN "startDate"
    `);
    await queryRunner.query(`DROP INDEX "public"."IDX_ORDER_ATTRIBUTED_ADMIN"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ORDER_LEAD"`);
    await queryRunner.query(`
      ALTER TABLE "orders"
        DROP COLUMN "attributedAt",
        DROP COLUMN "attributionSource",
        DROP COLUMN "attributedAdminId",
        DROP COLUMN "leadId"
    `);
    await queryRunner.query(
      `DROP TYPE "public"."orders_attributionsource_enum"`,
    );
  }
}
