import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  CanActivate,
} from '@nestjs/common';
import { UserTypes } from '../enums/role.enum';

@Injectable()
export class AdminAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (
      user.principalType !== 'admin' ||
      user.userType !== UserTypes.System ||
      !user.isVerified
    ) {
      throw new UnauthorizedException(
        'You are not authorized to call this API',
      );
    }

    return true;
  }
}
