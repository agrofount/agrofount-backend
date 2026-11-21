import { MigrationInterface, QueryRunner } from 'typeorm';

type RolePermission = { resource: string; actions: string[] };

/**
 * Adds "create" (add a lead by hand, for CS and field staff) and "reassign"
 * (move an owned lead to another admin) to the leads resource. Roles that can
 * already update leads get "create". "reassign" is not granted: like
 * view_reports it is given deliberately, and super admins always have it.
 */
export class LeadsCreateReassignPermission1794700200000
  implements MigrationInterface
{
  name = 'LeadsCreateReassignPermission1794700200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const roles: { id: string; permissions: RolePermission[] | null }[] =
      await queryRunner.query(`SELECT "id", "permissions" FROM "role"`);
    for (const role of roles) {
      const current = role.permissions ?? [];
      const leads = current.find((p) => p.resource === 'leads');
      if (
        !leads ||
        !leads.actions.includes('update') ||
        leads.actions.includes('create')
      ) {
        continue;
      }
      const next = current.map((p) =>
        p.resource === 'leads'
          ? { ...p, actions: [...p.actions, 'create'] }
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
      if (!leads) continue;
      if (
        !leads.actions.includes('create') &&
        !leads.actions.includes('reassign')
      )
        continue;
      const next = current.map((p) =>
        p.resource === 'leads'
          ? {
              ...p,
              actions: p.actions.filter(
                (a) => a !== 'create' && a !== 'reassign',
              ),
            }
          : p,
      );
      await queryRunner.query(
        `UPDATE "role" SET "permissions" = $1::json WHERE "id" = $2`,
        [JSON.stringify(next), role.id],
      );
    }
  }
}
