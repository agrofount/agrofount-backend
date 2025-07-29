import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { configureAfricasTalking } from '../../config/africaTalking';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: 'AFRICAS_TALKING',
      useFactory: (configService: ConfigService) =>
        configureAfricasTalking(configService),
      inject: [ConfigService],
    },
  ],
  exports: ['AFRICAS_TALKING'],
})
export class AfricasTalkingModule {}
