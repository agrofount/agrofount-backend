import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import cookieParser = require('cookie-parser');
import helmet from 'helmet';
import { AppModule } from '../../../src/app.module';
import { GlobalExceptionFilter } from '../../../src/utils/Exceptions/globalException.filter';
import { CustomThrottlerGuard } from '../../../src/common/throttling/custom-throttler.guard';
import { FakeHttpService, FakeMailer } from './fakes';

export type TestApp = {
  app: INestApplication;
  dataSource: DataSource;
  mailer: FakeMailer;
  http: FakeHttpService;
  close: () => Promise<void>;
};

export type TestAppOptions = {
  /** Keep the real rate limiter. Off by default so suites do not trip 429s. */
  throttling?: boolean;
  /** Hook to add `overrideProvider(...)` calls before compile. */
  configure?: (builder: ReturnType<typeof Test.createTestingModule>) => void;
};

/**
 * Boots the real AppModule against the docker test Postgres/Redis with the
 * same global pipes, filter and middleware as src/main.ts. Only outbound
 * network boundaries (email, SMS/Paystack HTTP) are replaced by fakes.
 */
export async function createTestApp(
  options: TestAppOptions = {},
): Promise<TestApp> {
  const mailer = new FakeMailer();
  const http = new FakeHttpService();

  const builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider('SEND_IN_BLUE')
    .useValue(mailer)
    .overrideProvider(HttpService)
    .useValue(http);

  if (!options.throttling) {
    builder.overrideProvider(CustomThrottlerGuard).useValue({
      canActivate: () => true,
    });
  }
  options.configure?.(builder);

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication({ rawBody: true });
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.use(helmet());
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
    }),
  );
  app.use(cookieParser());
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useLogger(process.env.E2E_LOGS ? new Logger() : false);
  await app.init();
  // Bind to 127.0.0.1 up front. Left alone, supertest listens on a wildcard
  // ephemeral port per request, which can collide with another local server
  // and surface as random 404s on routes that exist.
  await app.listen(0, '127.0.0.1');
  // Suites that call app.listen() themselves keep working: the app is bound.
  app.listen = (async () => app.getHttpServer()) as typeof app.listen;

  return {
    app,
    dataSource: app.get(DataSource),
    mailer,
    http,
    close: () => app.close(),
  };
}
