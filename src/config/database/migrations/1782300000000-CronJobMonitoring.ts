import { MigrationInterface, QueryRunner } from 'typeorm';

export class CronJobMonitoring1782300000000 implements MigrationInterface {
  name = 'CronJobMonitoring1782300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "cron_job_config" (
        "jobName"            varchar(60)   NOT NULL,
        "enabled"            boolean       NOT NULL DEFAULT false,
        "lastRunAt"          TIMESTAMP WITH TIME ZONE,
        "lastRunStatus"      varchar(10),
        "lastRunDurationMs"  integer,
        "lastRunError"       text,
        "totalRuns"          integer       NOT NULL DEFAULT 0,
        "totalSuccesses"     integer       NOT NULL DEFAULT 0,
        "totalFailures"      integer       NOT NULL DEFAULT 0,
        "updatedBy"          uuid,
        "updatedAt"          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_cron_job_config" PRIMARY KEY ("jobName")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "cron_job_run" (
        "id"           uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "jobName"      varchar(60)   NOT NULL,
        "status"       varchar(10)   NOT NULL,
        "startedAt"    TIMESTAMP WITH TIME ZONE NOT NULL,
        "finishedAt"   TIMESTAMP WITH TIME ZONE,
        "durationMs"   integer,
        "sentCount"    integer,
        "totalCount"   integer,
        "errorMessage" text,
        "createdAt"    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_cron_job_run" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_cron_job_run_name_started"
      ON "cron_job_run" ("jobName", "startedAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_cron_job_run_name_started"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "cron_job_run"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "cron_job_config"`);
  }
}
