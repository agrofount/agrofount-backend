import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerException, ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  protected async throwThrottlingException(
    context: ExecutionContext,
  ): Promise<void> {
    const request = context.switchToHttp().getRequest<{ url?: string }>();
    const url = request?.url ?? '';

    if (url.includes('ai-farm-assistant')) {
      throw new ThrottlerException(
        'You have sent too many messages to Ayo for now. Please wait a little while before asking your next question.',
      );
    }

    throw new ThrottlerException(
      'You are making requests too quickly. Please slow down and try again in a moment.',
    );
  }
}
