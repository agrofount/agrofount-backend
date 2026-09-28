import { MigrationInterface, QueryRunner } from 'typeorm';

export class Complaints1782570000000 implements MigrationInterface {
  name = 'Complaints1782570000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "complaints" (
        "id"               uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId"           uuid NOT NULL,
        "orderId"          uuid,
        "subject"          varchar(150) NOT NULL,
        "description"      text NOT NULL,
        "status"           varchar(20) NOT NULL DEFAULT 'open',
        "priority"         varchar(10) NOT NULL DEFAULT 'medium',
        "assignedAdminId"  uuid,
        "resolutionNotes"  text,
        "resolvedAt"       TIMESTAMP WITH TIME ZONE,
        "createdAt"        TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"        TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_complaints" PRIMARY KEY ("id"),
        CONSTRAINT "FK_complaints_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_complaints_order" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "FK_complaints_assigned_admin" FOREIGN KEY ("assignedAdminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "CHK_complaints_status" CHECK ("status" IN ('open', 'in_progress', 'resolved', 'closed')),
        CONSTRAINT "CHK_complaints_priority" CHECK ("priority" IN ('low', 'medium', 'high'))
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_complaints_user_id"
      ON "complaints" ("userId")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_complaints_status"
      ON "complaints" ("status")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_complaints_created_at"
      ON "complaints" ("createdAt")
    `);

    // Speeds up the "does this user have an unresolved complaint" lookup used
    // when excluding customers from bulk voucher segments.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_complaints_unresolved_user"
      ON "complaints" ("userId")
      WHERE "status" IN ('open', 'in_progress')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_complaints_unresolved_user"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_complaints_created_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_complaints_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_complaints_user_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "complaints"`);
  }
}
