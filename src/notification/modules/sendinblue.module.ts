import { DataSource } from 'typeorm';
import {
  isNotificationExcluded,
  NotificationExcludedError,
} from '../utils/notification-exclusions';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { configureSendInBlue } from '../../config/sendInBlue.config';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: 'SEND_IN_BLUE',
      useFactory: (configService: ConfigService, dataSource: DataSource) => {
        const provider = configureSendInBlue(configService);
        return {
          ...provider,
          sendEmail: async (...args: Parameters<typeof provider.sendEmail>) => {
            if (
              await isNotificationExcluded(dataSource.manager, {
                email: args[0],
              })
            )
              throw new NotificationExcludedError();
            return provider.sendEmail(...args);
          },
          sendCustomEmail: async (
            ...args: Parameters<typeof provider.sendCustomEmail>
          ) => {
            if (
              await isNotificationExcluded(dataSource.manager, {
                email: args[0],
              })
            )
              throw new NotificationExcludedError();
            return provider.sendCustomEmail(...args);
          },
        };
      },
      inject: [ConfigService, DataSource],
    },
  ],
  exports: ['SEND_IN_BLUE'],
})
export class SendInBlueModule {}
