import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Reads the bearer token when there is one, and lets the request through as
 * an anonymous caller when there is none or it is invalid. For public routes
 * that show more to a signed-in admin.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser>(_err: unknown, user: TUser | false): TUser | null {
    return user || null;
  }
}
