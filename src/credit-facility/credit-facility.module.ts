import { Module } from '@nestjs/common';
import { CreditFacilityService } from './credit-facility.service';
import { CreditFacilityController } from './credit-facility.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CreditFacilityRequestEntity } from './entities/credit-facility.entity';
import { CreditAssessmentEntity } from './entities/credit-assessment.entity';
import { WalletModule } from '../wallet/wallet.module';
import { HttpModule } from '@nestjs/axios';
import { OrderEntity } from 'src/order/entities/order.entity';
import { NotificationModule } from '../notification/notification.module';
import { DisbursementEntity } from '../disbursement/entities/disbursement.entity';
import { DisbursementController } from '../disbursement/disbursement.controller';
import { DisbursementModule } from 'src/disbursement/disbursement.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CreditFacilityRequestEntity,
      CreditAssessmentEntity,
      OrderEntity,
      DisbursementEntity, // Register DisbursementEntity
    ]),
    WalletModule,
    HttpModule,
    NotificationModule, // Add NotificationModule import
    DisbursementModule,
  ],
  controllers: [CreditFacilityController, DisbursementController],
  providers: [CreditFacilityService],
  exports: [CreditFacilityService], // Export CreditFacilityService for use in other modules
})
export class CreditFacilityModule {}
