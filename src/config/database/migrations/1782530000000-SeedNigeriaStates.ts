import { randomUUID } from 'crypto';
import { MigrationInterface, QueryRunner } from 'typeorm';

export const NIGERIA_STATES = [
  ['Abia', 'AB'],
  ['Adamawa', 'AD'],
  ['Akwa Ibom', 'AK'],
  ['Anambra', 'AN'],
  ['Bauchi', 'BA'],
  ['Bayelsa', 'BY'],
  ['Benue', 'BE'],
  ['Borno', 'BO'],
  ['Cross River', 'CR'],
  ['Delta', 'DE'],
  ['Ebonyi', 'EB'],
  ['Edo', 'ED'],
  ['Ekiti', 'EK'],
  ['Enugu', 'EN'],
  ['Federal Capital Territory', 'FC'],
  ['Gombe', 'GO'],
  ['Imo', 'IM'],
  ['Jigawa', 'JI'],
  ['Kaduna', 'KD'],
  ['Kano', 'KN'],
  ['Katsina', 'KT'],
  ['Kebbi', 'KE'],
  ['Kogi', 'KO'],
  ['Kwara', 'KW'],
  ['Lagos', 'LA'],
  ['Nasarawa', 'NA'],
  ['Niger', 'NI'],
  ['Ogun', 'OG'],
  ['Ondo', 'ON'],
  ['Osun', 'OS'],
  ['Oyo', 'OY'],
  ['Plateau', 'PL'],
  ['Rivers', 'RI'],
  ['Sokoto', 'SO'],
  ['Taraba', 'TA'],
  ['Yobe', 'YO'],
  ['Zamfara', 'ZA'],
] as const;

export class SeedNigeriaStates1782530000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    let [country] = await queryRunner.query(
      `SELECT id FROM country WHERE LOWER(name) = 'nigeria'`,
    );
    if (!country) {
      [country] = await queryRunner.query(
        `INSERT INTO country (id, name, code, "isActive") VALUES ($1, 'Nigeria', 'NGA', true) RETURNING id`,
        [randomUUID()],
      );
    }

    for (const [name, code] of NIGERIA_STATES) {
      const aliases = [name.toLowerCase()];
      if (code === 'FC') aliases.push('abuja', 'fct');
      if (code === 'OY') aliases.push('ibadan');
      const existing = await queryRunner.query(
        `SELECT id FROM state WHERE "countryId" = $1 AND LOWER(name) = ANY($2::text[])`,
        [country.id, aliases],
      );
      if (existing.length > 1) {
        throw new Error(
          `Multiple records match ${name}; reconcile them before seeding`,
        );
      }
      if (existing.length === 1) {
        // Preserve IDs and existing codes referenced by products and pricing.
        await queryRunner.query(
          `UPDATE state SET name = $1, "updatedAt" = NOW() WHERE id = $2 AND name <> $1`,
          [name, existing[0].id],
        );
      } else {
        await queryRunner.query(
          `INSERT INTO state (id, name, code, "countryId", "isActive") VALUES ($1, $2, $3, $4, true)`,
          [randomUUID(), name, code, country.id],
        );
      }
    }
  }

  public async down(): Promise<void> {
    // Reference data may be used by orders and pricing; retain it on rollback.
  }
}
