import './polyfills/node-buffer';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger, ValidationPipe } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';
import { GlobalExceptionFilter } from './utils/Exceptions/globalException.filter';
import helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS || 1);
  app.getHttpAdapter().getInstance().set('trust proxy', trustProxyHops);
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
  app.useLogger(new Logger());
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Configure CORS
  const defaultOrigins = [
    'http://localhost:3000',
    'http://localhost:5174',
    'http://localhost:5175',
    'https://agrofount.com',
    'https://www.agrofount.com',
    'https://admin.agrofount.com',
    'https://admin-staging.agrofount.com',
    'https://admin-dev.agrofount.com',
    'https://dev.agrofount.com',
    'https://staging.agrofount.com',
    'https://dev-client.agrofount.com',
    'https://dev-admin.agrofount.com',
    'https://dev.development.agrofount.com',
    'https://backend.agrofount.com',
    'https://prod-client.agrofount.com',
    'https://prod-admin.agrofount.com',
  ];
  const allowedOrigins = (process.env.CORS_ORIGINS || defaultOrigins.join(','))
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: allowedOrigins,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: false,
    allowedHeaders: 'Content-Type, Accept, Authorization, X-Session-Id',
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Agrofount Backend')
    .setDescription('Your API description')
    .setVersion('1.0')
    .addBearerAuth()
    .addServer('http://localhost:3000/', 'Local environment')
    .addServer('https://api-dev.agrofount.com/', 'Dev environment')
    .addServer('https://api-staging.agrofount.com/', 'Staging')
    .addServer('https://api.agrofount.com/', 'Production')
    .addTag('Agrofount')
    .build();

  if (
    process.env.NODE_ENV !== 'production' ||
    process.env.ENABLE_SWAGGER === 'true'
  ) {
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api', app, document);
  }

  app.enableShutdownHooks();

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap().catch((error) => {
  Logger.error('Fatal application startup failure', error?.stack || error);
  process.exitCode = 1;
});
