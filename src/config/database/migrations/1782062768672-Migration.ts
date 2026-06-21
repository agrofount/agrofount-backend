import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1782062768672 implements MigrationInterface {
  name = 'Migration1782062768672';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasConstraint = async (tableName: string, constraintName: string) => {
      const result = await queryRunner.query(
        `
          SELECT 1
          FROM information_schema.table_constraints
          WHERE table_schema = current_schema()
            AND table_name = $1
            AND constraint_name = $2
          LIMIT 1
        `,
        [tableName, constraintName],
      );

      return result.length > 0;
    };

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "certifications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "issuingOrganization" character varying, "issueDate" date, "expirationDate" date, "certificationId" character varying, "description" character varying, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, CONSTRAINT "PK_fd763d412e4a1fb1b6dadd6e72b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "credit_history" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "amount" numeric(10,2) NOT NULL, "action" character varying(50) NOT NULL, "notes" text, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" uuid, "creditFacilityId" uuid, CONSTRAINT "PK_1f23079c40e17baba72a8f83d41" PRIMARY KEY ("id"))`,
    );

    if (await queryRunner.hasTable('ai_settings')) {
      await queryRunner.query(
        `ALTER TABLE "ai_settings" ALTER COLUMN "costPer1MInputTokensUSD" SET DEFAULT '0.06'`,
      );
      await queryRunner.query(
        `ALTER TABLE "ai_settings" ALTER COLUMN "costPer1MOutputTokensUSD" SET DEFAULT '0.24'`,
      );
    }

    if (
      (await queryRunner.hasTable('credit_history')) &&
      (await queryRunner.hasTable('user')) &&
      !(await hasConstraint(
        'credit_history',
        'FK_7c689c904a5dadd63126a5c948f',
      ))
    ) {
      await queryRunner.query(
        `ALTER TABLE "credit_history" ADD CONSTRAINT "FK_7c689c904a5dadd63126a5c948f" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
      );
    }

    if (
      (await queryRunner.hasTable('credit_history')) &&
      (await queryRunner.hasTable('credit_facility_request')) &&
      !(await hasConstraint(
        'credit_history',
        'FK_10630eac10287778cf5f22af205',
      ))
    ) {
      await queryRunner.query(
        `ALTER TABLE "credit_history" ADD CONSTRAINT "FK_10630eac10287778cf5f22af205" FOREIGN KEY ("creditFacilityId") REFERENCES "credit_facility_request"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "credit_history" DROP CONSTRAINT "FK_10630eac10287778cf5f22af205"`,
    );
    await queryRunner.query(
      `ALTER TABLE "credit_history" DROP CONSTRAINT "FK_7c689c904a5dadd63126a5c948f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_settings" ALTER COLUMN "costPer1MOutputTokensUSD" SET DEFAULT 0.24`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_settings" ALTER COLUMN "costPer1MInputTokensUSD" SET DEFAULT 0.06`,
    );
    await queryRunner.query(`DROP TABLE "credit_history"`);
    await queryRunner.query(`DROP TABLE "certifications"`);
  }
}
