import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { DisbursementEntity } from './entities/disbursement.entity';
import { WalletService } from '../wallet/wallet.service';

@Injectable()
export class DisbursementService {
  constructor(
    @InjectRepository(DisbursementEntity)
    private readonly disbursementRepository: Repository<DisbursementEntity>,
    private readonly walletService: WalletService,
    private dataSource: DataSource,
  ) {}

  async processPendingDisbursements() {
    return this.dataSource.transaction(async (transactionalEntityManager) => {
      const disbursementRepo =
        transactionalEntityManager.getRepository(DisbursementEntity);

      const now = new Date();
      const pending = await disbursementRepo.find({
        where: { completed: false },
        relations: ['creditFacility', 'creditFacility.user'],
      });
      const results = [];
      for (const disb of pending) {
        if (disb.scheduledAt <= now) {
          const wallet = await this.walletService.getWalletByUserId(
            disb.creditFacility.user.id,
          );
          await this.walletService.handleApprovedCredit(
            wallet.id,
            Number(disb.amount),
            transactionalEntityManager,
          );
          disb.completed = true;
          await this.disbursementRepository.save(disb);
          results.push({ id: disb.id, status: 'disbursed' });
        }
      }
      return { processed: results.length, details: results };
    });
  }
}
