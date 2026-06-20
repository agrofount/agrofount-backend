import { Module } from '@nestjs/common';
import { CreditFacilityService } from './credit-facility.service';
import { CreditFacilityController } from './credit-facility.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CreditFacilityRequestEntity } from './entities/credit-facility.entity';
import { CreditAssessmentEntity } from './entities/credit-assessment.entity';
import { WalletModule } from '../wallet/wallet.module';
import { HttpModule } from '@nestjs/axios';
import { OrderEntity } from '../order/entities/order.entity';
import { NotificationModule } from '../notification/notification.module';
import { DisbursementEntity } from '../disbursement/entities/disbursement.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CreditFacilityRequestEntity,
      CreditAssessmentEntity,
      OrderEntity,
      DisbursementEntity, // Register DisbursementEntity
    ]),
    WalletModule,
    HttpModule.register({ timeout: 10_000, maxRedirects: 3 }),
    NotificationModule,
  ],
  controllers: [CreditFacilityController],
  providers: [CreditFacilityService],
  exports: [CreditFacilityService], // Export CreditFacilityService for use in other modules
})
export class CreditFacilityModule {}
