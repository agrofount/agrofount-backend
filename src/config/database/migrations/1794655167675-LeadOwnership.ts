import { MigrationInterface, QueryRunner } from 'typeorm';

export class LeadOwnership1794655167675 implements MigrationInterface {
  name = 'LeadOwnership1794655167675';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "lead_notes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "leadId" uuid NOT NULL, "authorId" uuid NOT NULL, "body" text NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_1fa7d688fd75d75ea298a98e290" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_LEAD_NOTE_LEAD" ON "lead_notes" ("leadId") `,
    );
    await queryRunner.query(`ALTER TABLE "leads" ADD "ownerId" uuid`);
    await queryRunner.query(`ALTER TABLE "leads" ADD "assignedAt" TIMESTAMP`);
    await queryRunner.query(
      `CREATE INDEX "IDX_LEAD_OWNER" ON "leads" ("ownerId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "lead_notes" ADD CONSTRAINT "FK_f7632933386d769db804a4917d0" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "lead_notes" DROP CONSTRAINT "FK_f7632933386d769db804a4917d0"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_LEAD_OWNER"`);
    await queryRunner.query(`ALTER TABLE "leads" DROP COLUMN "assignedAt"`);
    await queryRunner.query(`ALTER TABLE "leads" DROP COLUMN "ownerId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_LEAD_NOTE_LEAD"`);
    await queryRunner.query(`DROP TABLE "lead_notes"`);
  }
}
