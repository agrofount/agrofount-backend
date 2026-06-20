import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DisbursementEntity } from './entities/disbursement.entity';
import { WalletService } from '../wallet/wallet.service';

@Injectable()
export class DisbursementService {
  constructor(
    private readonly walletService: WalletService,
    private dataSource: DataSource,
  ) {}

  async processPendingDisbursements() {
    return this.dataSource.transaction(async (transactionalEntityManager) => {
      const disbursementRepo =
        transactionalEntityManager.getRepository(DisbursementEntity);

      const pending = await disbursementRepo
        .createQueryBuilder('disbursement')
        .innerJoinAndSelect('disbursement.creditFacility', 'creditFacility')
        .innerJoinAndSelect('creditFacility.user', 'user')
        .where('disbursement.completed = false')
        .andWhere('disbursement.scheduledAt <= :now', { now: new Date() })
        .orderBy('disbursement.scheduledAt', 'ASC')
        .limit(100)
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getMany();
      const results = [];
      for (const disb of pending) {
        const wallet = await this.walletService.getWalletByUserId(
          disb.creditFacility.user.id,
          transactionalEntityManager,
        );
        await this.walletService.handleApprovedCredit(
          wallet.id,
          Number(disb.amount),
          `disbursement:${disb.id}`,
          disb.creditFacility.id,
          transactionalEntityManager,
        );
        disb.completed = true;
        await disbursementRepo.save(disb);
        results.push({ id: disb.id, status: 'disbursed' });
      }
      return { processed: results.length, details: results };
    });
  }
}
