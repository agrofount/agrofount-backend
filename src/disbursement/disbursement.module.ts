import { Module } from '@nestjs/common';
import { DisbursementService } from './disbursement.service';
import { DisbursementController } from './disbursement.controller';
import { WalletModule } from 'src/wallet/wallet.module';
import { DisbursementEntity } from './entities/disbursement.entity';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DisbursementEntity, // Register DisbursementEntity
    ]),
    WalletModule,
  ],
  controllers: [DisbursementController],
  providers: [DisbursementService],
  exports: [DisbursementService], // Export DisbursementService for use in other modules
})
export class DisbursementModule {}
