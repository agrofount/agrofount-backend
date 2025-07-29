import { Module } from '@nestjs/common';
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
import { SendgridModule } from './notification/modules/sendgrid.module';
import { SendInBlueModule } from './notification/modules/sendinblue.module';
import { CartModule } from './cart/cart.module';
import appConfig from './config/app.config';
import { CacheModule } from '@nestjs/cache-manager';
import { redisStore } from 'cache-manager-redis-yet';
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
import { AiChatModule } from './ai-chat/ai-chat.module';
import { DisbursementModule } from './disbursement/disbursement.module';
import { SupplyChainModule } from './supply-chain/supply-chain.module';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        ...configService.get('database'), // Leverage the registered config
        autoLoadEntities: true,
      }),
    }),
    ConfigModule.forRoot({
      load: [databaseConfig, appConfig, termiiConfig],
      isGlobal: true,
    }),
    AuthModule,
    UserModule,
    ProductModule,
    OrderModule,
    PaymentModule,
    SendgridModule,
    SendInBlueModule,
    CartModule,
    UploadModule,
    CacheModule.registerAsync({
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const redisUrl = configService.get<string>('REDIS_URL');
        return {
          store: await redisStore({
            url: redisUrl,
            password: configService.get<string>('REDIS_SECRET'),
          }),
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
    AdminsModule,
    ContactModule,
    SupplyChainModule,
    AuditLogModule,
    RoleModule,
    PermissionModule,
    BlogModule,
    InvoiceModule,
    VoucherModule,
    AiChatModule,
    DisbursementModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
