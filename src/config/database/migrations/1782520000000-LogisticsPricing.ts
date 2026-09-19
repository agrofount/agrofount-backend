import { MigrationInterface, QueryRunner } from 'typeorm';

export class LogisticsPricing1782520000000 implements MigrationInterface {
  name = 'LogisticsPricing1782520000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."logistics_pricing_pricingmode_enum" AS ENUM ('per_order', 'per_unit', 'per_carton');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "logistics_pricing" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "primaryCategory" character varying,
        "category" character varying,
        "subCategory" character varying,
        "unit" character varying,
        "pricingMode" "public"."logistics_pricing_pricingmode_enum" NOT NULL,
        "price" numeric(10,2) NOT NULL,
        "cartonSize" integer,
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        "stateId" uuid NOT NULL,
        CONSTRAINT "PK_logistics_pricing" PRIMARY KEY ("id"),
        CONSTRAINT "FK_logistics_pricing_state" FOREIGN KEY ("stateId") REFERENCES "state"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "CHK_logistics_pricing_carton_size" CHECK ("pricingMode" != 'per_carton' OR "cartonSize" IS NOT NULL)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_logistics_pricing_state_active"
      ON "logistics_pricing" ("stateId", "isActive")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_logistics_pricing_match"
      ON "logistics_pricing" ("stateId", "primaryCategory", "category", "subCategory", "unit")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_logistics_pricing_match"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_logistics_pricing_state_active"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "logistics_pricing"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."logistics_pricing_pricingmode_enum"`,
    );
  }
}
