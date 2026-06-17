import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import * as crypto from 'crypto';

@Injectable()
export class WebhookGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    const secret = process.env.PAYSTACK_SECRET_KEY;
    const signature = request.headers['x-paystack-signature'];
    if (!secret || typeof signature !== 'string') {
      throw new UnauthorizedException('Invalid webhook signature');
    }
    const rawBody = (request as Request & { rawBody?: Buffer }).rawBody;
    const hash = crypto
      .createHmac('sha512', secret)
      .update(rawBody || Buffer.from(JSON.stringify(request.body)))
      .digest('hex');

    const expected = Buffer.from(hash, 'hex');
    const received = Buffer.from(signature, 'hex');
    if (
      expected.length !== received.length ||
      !crypto.timingSafeEqual(expected, received)
    ) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    return true;
  }
}
