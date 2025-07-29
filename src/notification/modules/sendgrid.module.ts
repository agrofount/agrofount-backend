import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { configureSendGrid } from '../../config/sendgrid.config';
import { NotificationModule } from '../notification.module';

@Module({
  imports: [ConfigModule, NotificationModule],
  providers: [
    {
      provide: 'SENDGRID',
      useFactory: (configService: ConfigService) =>
        configureSendGrid(configService),
      inject: [ConfigService],
    },
  ],
  exports: ['SENDGRID'],
})
export class SendgridModule {}
