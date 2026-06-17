import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorator/role.decorator';
import { Role } from '../enums/role.enum';
import { ACTIONS } from '../../permission/Enum/permissions.enum';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      'permissions',
      [context.getHandler(), context.getClass()],
    );
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (
      (!requiredPermissions || requiredPermissions.length === 0) &&
      (!requiredRoles || requiredRoles.length === 0)
    ) {
      return true; // No specific permissions required
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.roles) {
      throw new ForbiddenException('Access Denied: No role assigned');
    }

    const userRoles = user.roles.map((role) => role.name);

    if (userRoles.includes(Role.SuperAdmin)) {
      return true;
    }

    if (
      requiredRoles?.length &&
      !requiredRoles.some((role) => userRoles.includes(role))
    ) {
      throw new ForbiddenException('Access Denied: Insufficient role');
    }

    if (!requiredPermissions?.length) return true;

    const userPermissions = user.roles.flatMap(
      (role) => role.permissions || [],
    );

    // Check if the user has all required permissions
    const normalize = (value: string) =>
      value.replace(/[^a-z0-9]/gi, '').toLowerCase();

    const knownActions = Object.values(ACTIONS);
    const hasPermission = requiredPermissions.every((perm) => {
      const required = normalize(perm);
      return userPermissions.some((permission) => {
        const exactMatch = permission.actions.some(
          (action) =>
            normalize(`${action}_${permission.resource}`) === required,
        );
        const managesExactResource =
          permission.actions.some(
            (action) => normalize(action) === normalize(ACTIONS.MANAGE),
          ) &&
          knownActions.some(
            (action) =>
              normalize(`${action}_${permission.resource}`) === required,
          );
        return exactMatch || managesExactResource;
      });
    });

    if (!hasPermission) {
      throw new ForbiddenException('Access Denied: Insufficient permissions');
    }

    return true;
  }
}
