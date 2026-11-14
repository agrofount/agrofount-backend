import { MigrationInterface, QueryRunner } from 'typeorm';

type RolePermission = { resource: string; actions: string[] };

/**
 * Lead ownership adds an "assign" action to the leads resource. Roles that
 * can already update leads get it, so the people working leads today can
 * claim them. "view_reports" (the all-owners leaderboard) is not granted: it
 * is new and left for admins to give deliberately.
 */
export class LeadsAssignPermission1794655200000 implements MigrationInterface {
  name = 'LeadsAssignPermission1794655200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const roles: { id: string; permissions: RolePermission[] | null }[] =
      await queryRunner.query(`SELECT "id", "permissions" FROM "role"`);
    for (const role of roles) {
      const current = role.permissions ?? [];
      const leads = current.find((p) => p.resource === 'leads');
      if (
        !leads ||
        !leads.actions.includes('update') ||
        leads.actions.includes('assign')
      ) {
        continue;
      }
      const next = current.map((p) =>
        p.resource === 'leads'
          ? { ...p, actions: [...p.actions, 'assign'] }
          : p,
      );
      await queryRunner.query(
        `UPDATE "role" SET "permissions" = $1::json WHERE "id" = $2`,
        [JSON.stringify(next), role.id],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const roles: { id: string; permissions: RolePermission[] | null }[] =
      await queryRunner.query(`SELECT "id", "permissions" FROM "role"`);
    for (const role of roles) {
      const current = role.permissions ?? [];
      const leads = current.find((p) => p.resource === 'leads');
      if (!leads?.actions.includes('assign')) continue;
      const next = current.map((p) =>
        p.resource === 'leads'
          ? { ...p, actions: p.actions.filter((a) => a !== 'assign') }
          : p,
      );
      await queryRunner.query(
        `UPDATE "role" SET "permissions" = $1::json WHERE "id" = $2`,
        [JSON.stringify(next), role.id],
      );
    }
  }
}
