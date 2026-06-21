import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1782048405629 implements MigrationInterface {
  name = 'Migration1782048405629';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "certifications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "issuingOrganization" character varying, "issueDate" date, "expirationDate" date, "certificationId" character varying, "description" character varying, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, CONSTRAINT "PK_fd763d412e4a1fb1b6dadd6e72b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "credit_history" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "amount" numeric(10,2) NOT NULL, "action" character varying(50) NOT NULL, "notes" text, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" uuid, "creditFacilityId" uuid, CONSTRAINT "PK_1f23079c40e17baba72a8f83d41" PRIMARY KEY ("id"))`,
    );

    if (await queryRunner.hasTable('Admin')) {
      await queryRunner.query(`
        ALTER TABLE "Admin"
        ADD COLUMN IF NOT EXISTS "mfaEnabled" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "mfaSecretEncrypted" text NULL,
        ADD COLUMN IF NOT EXISTS "mfaRecoveryCodeHashes" jsonb NOT NULL DEFAULT '[]'::jsonb
      `);
      await queryRunner.query(
        `ALTER TABLE "Admin" ALTER COLUMN "mfaRecoveryCodeHashes" SET DEFAULT '[]'::jsonb`,
      );
    }

    const userCreditHistoryFkExists = await this.constraintExists(
      queryRunner,
      'FK_7c689c904a5dadd63126a5c948f',
    );
    if (
      !userCreditHistoryFkExists &&
      (await queryRunner.hasTable('user')) &&
      (await queryRunner.hasTable('credit_history'))
    ) {
      await queryRunner.query(
        `ALTER TABLE "credit_history" ADD CONSTRAINT "FK_7c689c904a5dadd63126a5c948f" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
      );
    }

    const facilityCreditHistoryFkExists = await this.constraintExists(
      queryRunner,
      'FK_10630eac10287778cf5f22af205',
    );
    if (
      !facilityCreditHistoryFkExists &&
      (await queryRunner.hasTable('credit_facility_request')) &&
      (await queryRunner.hasTable('credit_history'))
    ) {
      await queryRunner.query(
        `ALTER TABLE "credit_history" ADD CONSTRAINT "FK_10630eac10287778cf5f22af205" FOREIGN KEY ("creditFacilityId") REFERENCES "credit_facility_request"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('credit_history')) {
      await queryRunner.query(
        `ALTER TABLE "credit_history" DROP CONSTRAINT IF EXISTS "FK_10630eac10287778cf5f22af205"`,
      );
      await queryRunner.query(
        `ALTER TABLE "credit_history" DROP CONSTRAINT IF EXISTS "FK_7c689c904a5dadd63126a5c948f"`,
      );
    }

    if (await queryRunner.hasTable('Admin')) {
      await queryRunner.query(
        `ALTER TABLE "Admin" ALTER COLUMN "mfaRecoveryCodeHashes" SET DEFAULT '[]'`,
      );
    }

    await queryRunner.query(`DROP TABLE IF EXISTS "credit_history"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "certifications"`);
  }

  private async constraintExists(
    queryRunner: QueryRunner,
    constraintName: string,
  ): Promise<boolean> {
    const result = await queryRunner.query(
      `SELECT 1 FROM pg_constraint WHERE conname = $1 LIMIT 1`,
      [constraintName],
    );

    return result.length > 0;
  }
}
