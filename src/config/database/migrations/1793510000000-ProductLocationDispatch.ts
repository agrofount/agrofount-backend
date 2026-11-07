import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Optional dispatch centre on a product location, identified by its NIPOST
 * postcode. Additive only: nullable columns and one defaulted boolean.
 */
export class ProductLocationDispatch1793510000000
  implements MigrationInterface
{
  name = 'ProductLocationDispatch1793510000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "product_location"
        ADD COLUMN IF NOT EXISTS "dispatchName" character varying,
        ADD COLUMN IF NOT EXISTS "dispatchAddress" character varying,
        ADD COLUMN IF NOT EXISTS "dispatchPostcode" character varying(11),
        ADD COLUMN IF NOT EXISTS "dispatchPostcodeVerified" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "dispatchLga" character varying,
        ADD COLUMN IF NOT EXISTS "dispatchLatitude" double precision,
        ADD COLUMN IF NOT EXISTS "dispatchLongitude" double precision
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "product_location"
        DROP COLUMN IF EXISTS "dispatchLongitude",
        DROP COLUMN IF EXISTS "dispatchLatitude",
        DROP COLUMN IF EXISTS "dispatchLga",
        DROP COLUMN IF EXISTS "dispatchPostcodeVerified",
        DROP COLUMN IF EXISTS "dispatchPostcode",
        DROP COLUMN IF EXISTS "dispatchAddress",
        DROP COLUMN IF EXISTS "dispatchName"
    `);
  }
}
