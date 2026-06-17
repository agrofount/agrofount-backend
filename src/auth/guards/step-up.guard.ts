import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

@Injectable()
export class StepUpGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user;
    const issuedAt = Number(user?.tokenIssuedAt || 0);
    if (
      user?.principalType !== 'admin' ||
      !issuedAt ||
      Date.now() / 1000 - issuedAt > 10 * 60
    ) {
      throw new UnauthorizedException(
        'Recent administrator MFA authentication is required',
      );
    }
    return true;
  }
}
