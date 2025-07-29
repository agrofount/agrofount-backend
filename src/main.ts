import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger, ValidationPipe } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';
import { setupTriggers } from './config/database/triggers/script';
import { GlobalExceptionFilter } from './utils/Exceptions/globalException.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  app.use(cookieParser());
  app.useLogger(new Logger());
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Configure CORS
  app.enableCors({
    origin: [
      'http://localhost:3000',
      'http://localhost:5174',
      'http://localhost:5175',
      'https://api-dev.agrofount.com',
      'https://api-staging.agrofount.com',
      'https://api.agrofount.com',
      'https://agrofount.com',
      'https://www.agrofount.com',
      'https://admin.agrofount.com',
      'https://admin-staging.agrofount.com',
      'https://admin-dev.agrofount.com',
      'https://dev.agrofount.com',
      'https://staging.agrofount.com',
    ],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
    allowedHeaders: 'Content-Type, Accept, Authorization',
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

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api', app, document);

  // await setupTriggers();

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
