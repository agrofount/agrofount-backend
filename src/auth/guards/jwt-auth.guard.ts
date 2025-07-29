import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  //   private readonly logger = new Logger(JwtAuthGuard.name);
  canActivate(context: ExecutionContext) {
    // const request = context.switchToHttp().getRequest();
    // const authHeader = request.headers.authorization;
    // this.logger.debug(`Authorization Header: ${authHeader}`);

    // Add custom authentication logic here if needed
    return super.canActivate(context);
  }
}
