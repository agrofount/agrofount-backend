import { MigrationInterface, QueryRunner } from 'typeorm';

const LEADS_ACTIONS = ['read', 'update', 'delete', 'import', 'send'];

type RolePermission = { resource: string; actions: string[] };

/**
 * Lead routes used to be open to every admin. They are now gated by the
 * "leads" permission resource, so existing roles are granted all of its
 * actions to keep today's access. Admins can then narrow roles from the roles
 * page. Roles that already have a "leads" entry are left alone.
 */
export class LeadsPermissions1793540000000 implements MigrationInterface {
  name = 'LeadsPermissions1793540000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const roles: { id: string; permissions: RolePermission[] | null }[] =
      await queryRunner.query(`SELECT "id", "permissions" FROM "role"`);
    for (const role of roles) {
      const current = role.permissions ?? [];
      if (current.some((p) => p.resource === 'leads')) continue;
      const next = [...current, { resource: 'leads', actions: LEADS_ACTIONS }];
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
      if (!current.some((p) => p.resource === 'leads')) continue;
      await queryRunner.query(
        `UPDATE "role" SET "permissions" = $1::json WHERE "id" = $2`,
        [
          JSON.stringify(current.filter((p) => p.resource !== 'leads')),
          role.id,
        ],
      );
    }
  }
}
