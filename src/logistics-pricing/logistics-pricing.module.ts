import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LogisticsPricingController } from './logistics-pricing.controller';
import { LogisticsPricingService } from './logistics-pricing.service';
import { LogisticsPricingEntity } from './entities/logistics-pricing.entity';
import { StateEntity } from '../state/entities/state.entity';
import { StateModule } from '../state/state.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([LogisticsPricingEntity, StateEntity]),
    StateModule,
  ],
  controllers: [LogisticsPricingController],
  providers: [LogisticsPricingService],
  exports: [LogisticsPricingService],
})
export class LogisticsPricingModule {}
