import { BadRequestException, ExecutionContext, Logger } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { RequestAuditInterceptor } from './request-audit.interceptor';

describe('RequestAuditInterceptor', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  function setup() {
    const record = jest.fn().mockResolvedValue(undefined);
    const interceptor = new RequestAuditInterceptor({
      record,
    } as unknown as AuditLogService);
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          headers: {},
          originalUrl: '/order',
          path: '/order',
          body: {},
        }),
        getResponse: () => ({ statusCode: 201, setHeader: jest.fn() }),
      }),
    } as unknown as ExecutionContext;
    return { interceptor, context, record };
  }

  it.each([
    [new Error('Database query failed'), 500],
    [new BadRequestException('Invalid delivery state'), 400],
  ])(
    'records the failure status and preserves the exception (%s)',
    async (error, statusCode) => {
      const { interceptor, context, record } = setup();

      await expect(
        lastValueFrom(
          interceptor.intercept(context, {
            handle: () => throwError(() => error),
          }),
        ),
      ).rejects.toBe(error);

      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'failed', statusCode }),
      );
    },
  );

  it('keeps the response status for successful orders', async () => {
    const { interceptor, context, record } = setup();
    const order = { id: 'order-1' };

    await expect(
      lastValueFrom(
        interceptor.intercept(context, { handle: () => of(order) }),
      ),
    ).resolves.toBe(order);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'succeeded', statusCode: 201 }),
    );
  });
});
