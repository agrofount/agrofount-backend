import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.get<string[]>(
      'permissions',
      context.getHandler(),
    );

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true; // No specific permissions required
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.roles) {
      throw new ForbiddenException('Access Denied: No role assigned');
    }

    // Extract user's permissions as { resource, action } objects
    const userPermissions = user.roles.flatMap((role) => role.permissions);

    // Check if the user has all required permissions
    const hasPermission = requiredPermissions.every((perm) => {
      const [action, resource] = perm.split('_'); // Split 'resource_action'
      return userPermissions.some((p) => {
        return p.resource === resource && p.actions.includes(action);
      });
    });

    if (!hasPermission) {
      throw new ForbiddenException('Access Denied: Insufficient permissions');
    }

    return true;
  }
}
