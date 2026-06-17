import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  const context = (user: any) =>
    ({
      getHandler: () => function handler() {},
      getClass: () => class Controller {},
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext);

  it('matches multi-word permissions without trusting token formatting', () => {
    const reflector = {
      getAllAndOverride: (key: string) =>
        key === 'permissions' ? ['manage_credit_facility'] : undefined,
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    const user = {
      roles: [
        { permissions: [{ resource: 'creditFacility', actions: ['manage'] }] },
      ],
    };

    expect(guard.canActivate(context(user))).toBe(true);
  });

  it('denies missing permissions', () => {
    const reflector = {
      getAllAndOverride: (key: string) =>
        key === 'permissions' ? ['delete_users'] : undefined,
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(() => guard.canActivate(context({ roles: [] }))).toThrow(
      ForbiddenException,
    );
  });

  it('enforces role metadata independently of permissions', () => {
    const reflector = {
      getAllAndOverride: (key: string) =>
        key === 'roles' ? ['admin', 'staff'] : undefined,
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(context({ roles: [{ name: 'staff' }] }))).toBe(
      true,
    );
    expect(() =>
      guard.canActivate(context({ roles: [{ name: 'user' }] })),
    ).toThrow(ForbiddenException);
  });

  it('allows manage permission to satisfy actions for the same resource', () => {
    const reflector = {
      getAllAndOverride: (key: string) =>
        key === 'permissions' ? ['read_users'] : undefined,
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(
      guard.canActivate(
        context({
          roles: [
            { permissions: [{ resource: 'users', actions: ['manage'] }] },
          ],
        }),
      ),
    ).toBe(true);
  });

  it('allows superadmin roles to satisfy protected admin permissions', () => {
    const reflector = {
      getAllAndOverride: (key: string) =>
        key === 'permissions' ? ['read_permissions'] : undefined,
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(
      guard.canActivate(context({ roles: [{ name: 'superadmin' }] })),
    ).toBe(true);
  });
});
