import { MigrationInterface, QueryRunner } from 'typeorm';

export class Careers1763330000000 implements MigrationInterface {
  name = 'Careers1763330000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "career_job" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "title" character varying(180) NOT NULL,
        "slug" character varying(220) NOT NULL,
        "department" character varying(120) NOT NULL,
        "location" character varying(160) NOT NULL,
        "employmentType" character varying(30) NOT NULL,
        "workMode" character varying(30) NOT NULL,
        "summary" text NOT NULL,
        "description" text NOT NULL,
        "responsibilities" text array NOT NULL DEFAULT '{}',
        "requirements" text array NOT NULL DEFAULT '{}',
        "benefits" text array NOT NULL DEFAULT '{}',
        "salaryRange" character varying(120),
        "status" character varying(20) NOT NULL DEFAULT 'draft',
        "applicationDeadline" TIMESTAMP WITH TIME ZONE,
        "createdBy" uuid,
        "updatedBy" uuid,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_career_job" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "career_job_application" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "jobId" uuid NOT NULL,
        "fullName" character varying(140) NOT NULL,
        "email" character varying(254) NOT NULL,
        "phoneNumber" character varying(30) NOT NULL,
        "state" character varying(100) NOT NULL,
        "city" character varying(100) NOT NULL,
        "yearsOfExperience" integer NOT NULL DEFAULT 0,
        "linkedinUrl" character varying(255),
        "coverNote" text NOT NULL,
        "cvUrl" character varying(255) NOT NULL,
        "cvOriginalName" character varying(255),
        "cvContentType" character varying(120),
        "answers" jsonb,
        "status" character varying(20) NOT NULL DEFAULT 'new',
        "submittedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "reviewedBy" uuid,
        "reviewedAt" TIMESTAMP WITH TIME ZONE,
        "adminNotes" text,
        CONSTRAINT "PK_career_job_application" PRIMARY KEY ("id"),
        CONSTRAINT "FK_career_application_job" FOREIGN KEY ("jobId") REFERENCES "career_job"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_career_job_slug" ON "career_job" ("slug")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_career_job_status" ON "career_job" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_career_job_department" ON "career_job" ("department")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_career_job_location" ON "career_job" ("location")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_career_job_employment_type" ON "career_job" ("employmentType")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_career_application_job_email" ON "career_job_application" ("jobId", "email")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_career_application_job" ON "career_job_application" ("jobId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_career_application_email" ON "career_job_application" ("email")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_career_application_status" ON "career_job_application" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_career_application_submitted_at" ON "career_job_application" ("submittedAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "career_job_application"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "career_job"`);
  }
}
