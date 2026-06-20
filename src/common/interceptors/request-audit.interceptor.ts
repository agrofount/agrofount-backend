import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { Observable, from, of, throwError } from 'rxjs';
import { catchError, map, mergeMap } from 'rxjs/operators';
import { AuditLogService } from '../../audit-log/audit-log.service';

const SENSITIVE_KEYS = new Set([
  'password',
  'newpassword',
  'confirmpassword',
  'token',
  'refreshtoken',
  'authorization',
  'otp',
  'pin',
  'secret',
  'accesstoken',
]);

@Injectable()
export class RequestAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestAuditInterceptor.name);

  constructor(private readonly auditLogService: AuditLogService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<Request & { user?: Record<string, any> }>();
    const response = http.getResponse<Response>();
    const suppliedRequestId = String(request.headers['x-request-id'] || '');
    const requestId = /^[a-zA-Z0-9._:-]{8,100}$/.test(suppliedRequestId)
      ? suppliedRequestId
      : randomUUID();
    response.setHeader('x-request-id', requestId);
    const startedAt = Date.now();
    const shouldAudit = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(
      request.method,
    );

    return next.handle().pipe(
      mergeMap((value) =>
        from(
          this.finish(request, response, requestId, startedAt, shouldAudit),
        ).pipe(
          catchError((error) => {
            this.logger.error('Failed to persist request audit', error?.stack);
            return of(undefined);
          }),
          map(() => value),
        ),
      ),
      catchError((error) =>
        from(
          this.finish(
            request,
            response,
            requestId,
            startedAt,
            shouldAudit,
            error,
          ),
        ).pipe(
          catchError((auditError) => {
            this.logger.error(
              'Failed to persist failed-request audit',
              auditError?.stack,
            );
            return of(undefined);
          }),
          mergeMap(() => throwError(() => error)),
        ),
      ),
    );
  }

  private async finish(
    request: Request & { user?: Record<string, any> },
    response: Response,
    requestId: string,
    startedAt: number,
    shouldAudit: boolean,
    error?: any,
  ): Promise<void> {
    const statusCode = error?.status || response.statusCode || 500;
    const log = {
      requestId,
      method: request.method,
      route: request.originalUrl,
      statusCode,
      durationMs: Date.now() - startedAt,
      actorId: request.user?.id || null,
    };
    const message = JSON.stringify(log);
    if (statusCode >= 500) this.logger.error(message);
    else if (statusCode >= 400) this.logger.warn(message);
    else this.logger.log(message);

    if (!shouldAudit) return;
    const redacted = this.redact(request.body);
    await this.auditLogService.record({
      action: `${request.method} ${request.route?.path || request.path}`,
      entityType: request.baseUrl || request.path.split('/')[1] || 'unknown',
      userId: request.user?.id || null,
      userEmail: request.user?.email || null,
      actorType: request.user?.roles
        ? 'admin'
        : request.user
        ? 'user'
        : 'anonymous',
      requestId,
      method: request.method,
      route: request.originalUrl.slice(0, 300),
      payloadHash: createHash('sha256')
        .update(JSON.stringify(redacted || {}))
        .digest('hex'),
      outcome: error ? 'failed' : 'succeeded',
      statusCode,
      ipAddress: request.ip || null,
      userAgent:
        String(request.headers['user-agent'] || '').slice(0, 512) || null,
      reason: error
        ? String(error.message || 'Request failed').slice(0, 500)
        : null,
      changes: null,
    });
  }

  private redact(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => this.redact(item));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        SENSITIVE_KEYS.has(key.toLowerCase())
          ? '[REDACTED]'
          : this.redact(child),
      ]),
    );
  }
}
