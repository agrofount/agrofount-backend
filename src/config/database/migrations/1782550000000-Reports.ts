import { MigrationInterface, QueryRunner } from 'typeorm';

export class Reports1782550000000 implements MigrationInterface {
  name = 'Reports1782550000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "report_run" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying(160) NOT NULL,
        "type" character varying(30) NOT NULL,
        "format" character varying(10) NOT NULL,
        "periodStart" TIMESTAMP WITH TIME ZONE NOT NULL,
        "periodEnd" TIMESTAMP WITH TIME ZONE NOT NULL,
        "filters" jsonb NOT NULL DEFAULT '{}',
        "summary" jsonb NOT NULL DEFAULT '{}',
        "rows" jsonb NOT NULL DEFAULT '[]',
        "rowCount" integer NOT NULL DEFAULT 0,
        "createdBy" uuid NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_report_run" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_report_run_created_at" ON "report_run" ("createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_report_run_created_by" ON "report_run" ("createdBy")`,
    );

    await queryRunner.query(`
      CREATE TABLE "report_schedule" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying(160) NOT NULL,
        "type" character varying(30) NOT NULL,
        "format" character varying(10) NOT NULL,
        "frequency" character varying(20) NOT NULL,
        "dayOfWeek" integer NOT NULL DEFAULT 1,
        "dayOfMonth" integer NOT NULL DEFAULT 1,
        "time" time NOT NULL DEFAULT '08:00',
        "recipients" text array NOT NULL DEFAULT '{}',
        "filters" jsonb NOT NULL DEFAULT '{}',
        "active" boolean NOT NULL DEFAULT true,
        "nextRunAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "lastRunAt" TIMESTAMP WITH TIME ZONE,
        "createdBy" uuid NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_report_schedule" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_report_schedule_due" ON "report_schedule" ("active", "nextRunAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "report_schedule"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "report_run"`);
  }
}
