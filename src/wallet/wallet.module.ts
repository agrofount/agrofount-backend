import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WalletEntity } from './entities/wallet.entity';
import { SendInBlueModule } from '../notification/modules/sendinblue.module';
import { WalletTransactionEntity } from './entities/wallet-transactions.entity';
import { CreditFacilityRequestEntity } from 'src/credit-facility/entities/credit-facility.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WalletEntity,
      WalletTransactionEntity,
      CreditFacilityRequestEntity,
    ]),
    SendInBlueModule,
  ],
  controllers: [WalletController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
