import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

@Injectable()
export class UserAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user;
    if (!user || user.principalType !== 'user' || !user.isVerified) {
      throw new UnauthorizedException(
        'A verified customer account is required',
      );
    }
    return true;
  }
}
