import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthService } from '../../../src/auth/auth.service';
import { AuthPrincipalType } from '../../../src/auth/entities/auth-session.entity';
import { UserEntity } from '../../../src/user/entities/user.entity';
import { AdminEntity } from '../../../src/admins/entities/admin.entity';
import { RoleEntity } from '../../../src/role/entities/role.entity';
import { BusinessType, UserTypes } from '../../../src/auth/enums/role.enum';

export const DEFAULT_PASSWORD = 'Str0ng!Passw0rd';

let counter = 0;
const unique = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

export type TestPrincipal<T> = {
  entity: T;
  token: string;
  refreshToken: string;
  /** `{ Authorization: 'Bearer ...' }` for supertest `.set(...)`. */
  auth: { Authorization: string };
};

/**
 * Creates a verified customer and a live session, bypassing the OTP/email
 * flow. The public login flow itself is covered by the auth suite.
 */
export async function createUser(
  app: INestApplication,
  overrides: Partial<UserEntity> = {},
): Promise<TestPrincipal<UserEntity> & { password: string }> {
  const dataSource = app.get(DataSource);
  const id = unique();
  const password = DEFAULT_PASSWORD;
  const user = await dataSource.getRepository(UserEntity).save(
    dataSource.getRepository(UserEntity).create({
      firstname: 'Test',
      lastname: 'User',
      username: `user_${id}`,
      email: `user_${id}@agrofount.test`,
      phone: `+2348${Math.floor(100000000 + Math.random() * 899999999)}`,
      password,
      isVerified: true,
      userType: UserTypes.App,
      ...overrides,
    } as Partial<UserEntity>),
  );
  const session = await (app.get(AuthService) as any).createSession(
    AuthPrincipalType.User,
    user,
    {},
  );
  return {
    entity: user,
    password,
    token: session.accessToken,
    refreshToken: session.refreshToken,
    auth: { Authorization: `Bearer ${session.accessToken}` },
  };
}

type AdminOptions = {
  /** Role name. `superadmin` bypasses every permission check. */
  role?: string;
  permissions?: { resource: string; actions: string[] }[];
  overrides?: Partial<AdminEntity>;
};

/** Creates a verified admin with a role and a live session. */
export async function createAdmin(
  app: INestApplication,
  options: AdminOptions = {},
): Promise<TestPrincipal<AdminEntity> & { password: string }> {
  const dataSource = app.get(DataSource);
  const roleName = options.role ?? 'superadmin';
  const roleRepo = dataSource.getRepository(RoleEntity);
  let role = await roleRepo.findOne({ where: { name: roleName } });
  if (!role) {
    role = await roleRepo.save(
      roleRepo.create({
        name: roleName,
        description: `${roleName} (e2e)`,
        permissions: options.permissions ?? [],
      }),
    );
  }
  const id = unique();
  const password = DEFAULT_PASSWORD;
  const adminRepo = dataSource.getRepository(AdminEntity);
  const admin = await adminRepo.save(
    adminRepo.create({
      firstname: 'Test',
      lastname: 'Admin',
      username: `admin_${id}`,
      email: `admin_${id}@agrofount.test`,
      password,
      isVerified: true,
      userType: UserTypes.System,
      roles: [role],
      ...options.overrides,
    } as Partial<AdminEntity>),
  );
  const loaded = await adminRepo.findOne({
    where: { id: admin.id },
    relations: ['roles'],
  });
  const session = await (app.get(AuthService) as any).createSession(
    AuthPrincipalType.Admin,
    loaded,
    {},
  );
  return {
    entity: loaded,
    password,
    token: session.accessToken,
    refreshToken: session.refreshToken,
    auth: { Authorization: `Bearer ${session.accessToken}` },
  };
}

export const registerPayload = (overrides: Record<string, any> = {}) => ({
  username: `Farm ${unique()}`,
  identifier: `reg_${unique()}@agrofount.test`,
  password: DEFAULT_PASSWORD,
  businessType: BusinessType.Farmer,
  ...overrides,
});
