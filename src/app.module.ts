import { ClassSerializerInterceptor, Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { ProductModule } from './product/product.module';
import { OrderModule } from './order/order.module';
import { PaymentModule } from './payment/payment.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import databaseConfig from './config/database/database.config';
import { SendInBlueModule } from './notification/modules/sendinblue.module';
import { CartModule } from './cart/cart.module';
import appConfig from './config/app.config';
import { CacheModule } from '@nestjs/cache-manager';
import { UploadModule } from './upload/upload.module';
import { SubscriberModule } from './subscriber/subscriber.module';
import { WalletModule } from './wallet/wallet.module';
import { CreditFacilityModule } from './credit-facility/credit-facility.module';
import { CityModule } from './city/city.module';
import { StateModule } from './state/state.module';
import { CountryModule } from './country/country.module';
import { ReviewModule } from './review/review.module';
import { ProductLocationModule } from './product-location/product-location.module';
import { AdminsModule } from './admins/admins.module';
import { ContactModule } from './contact/contact.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { RoleModule } from './role/role.module';
import { PermissionModule } from './permission/permission.module';
import { ScheduleModule } from '@nestjs/schedule';
import { BlogModule } from './blog/blog.module';
import { InvoiceModule } from './invoice/invoice.module';
import { VoucherModule } from './voucher/voucher.module';
import termiiConfig from './config/termii.config';
// import { AiChatModule } from './ai-chat/ai-chat.module';
import { DisbursementModule } from './disbursement/disbursement.module';
import { SupplyChainModule } from './supply-chain/supply-chain.module';
import KeyvRedis from '@keyv/redis';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { validateEnvironment } from './config/env.validation';
import { RedisThrottlerStorage } from './common/throttling/redis-throttler.storage';
import { createHash } from 'crypto';
import { InventoryModule } from './inventory/inventory.module';
import { OutboxModule } from './outbox/outbox.module';
import { RequestAuditInterceptor } from './common/interceptors/request-audit.interceptor';
import { AppThrottlingModule } from './common/throttling/throttling.module';
import { CareersModule } from './careers/careers.module';
import { AiFarmAssistantModule } from './ai-farm-assistant/ai-farm-assistant.module';
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [databaseConfig, appConfig, termiiConfig],
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.getOrThrow<string>('REDIS_URL') },
        prefix: '{bull}',
      }),
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        ...configService.get('database'), // Leverage the registered config
        autoLoadEntities: true,
      }),
    }),
    ThrottlerModule.forRootAsync({
      imports: [AppThrottlingModule],
      inject: [RedisThrottlerStorage],
      useFactory: (storage: RedisThrottlerStorage) => ({
        storage,
        getTracker: (request: Record<string, any>) => {
          const identity =
            request.user?.id ||
            request.body?.identifier ||
            request.body?.challengeId ||
            request.body?.phone ||
            request.ip ||
            request.socket?.remoteAddress ||
            'unknown';
          return createHash('sha256')
            .update(String(identity).trim().toLowerCase())
            .digest('hex');
        },
        throttlers: [{ ttl: 60_000, limit: 120, blockDuration: 60_000 }],
      }),
    }),
    AuthModule,
    UserModule,
    ProductModule,
    OrderModule,
    PaymentModule,
    SendInBlueModule,
    CartModule,
    UploadModule,
    CacheModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const redisUrl = configService.get<string>('REDIS_URL');
        return {
          stores: [new KeyvRedis(redisUrl)],
        };
      },
      isGlobal: true,
    }),
    ScheduleModule.forRoot(),
    SubscriberModule,
    WalletModule,
    CreditFacilityModule,
    CityModule,
    StateModule,
    CountryModule,
    ReviewModule,
    ProductLocationModule,
    InventoryModule,
    OutboxModule,
    AdminsModule,
    ContactModule,
    SupplyChainModule,
    AuditLogModule,
    RoleModule,
    PermissionModule,
    BlogModule,
    InvoiceModule,
    VoucherModule,
    CareersModule,
    AiFarmAssistantModule,
    // AiChatModule,
    DisbursementModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ClassSerializerInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestAuditInterceptor,
    },
  ],
})
export class AppModule {}
