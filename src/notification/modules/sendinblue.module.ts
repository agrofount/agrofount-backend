import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { configureSendInBlue } from '../../config/sendInBlue.config';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: 'SEND_IN_BLUE',
      useFactory: (configService: ConfigService) =>
        configureSendInBlue(configService),
      inject: [ConfigService],
    },
  ],
  exports: ['SEND_IN_BLUE'],
})
export class SendInBlueModule {}
