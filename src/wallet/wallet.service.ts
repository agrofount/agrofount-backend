import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WalletEntity } from './entities/wallet.entity';
import { EntityManager, Repository } from 'typeorm';
import { WalletTransactionEntity } from './entities/wallet-transactions.entity';
import { TransactionStatus, TransactionType } from './types/wallet.type';
import { CreditFacilityRequestEntity } from 'src/credit-facility/entities/credit-facility.entity';

@Injectable()
export class WalletService {
  constructor(
    @InjectRepository(WalletEntity)
    private readonly walletRepository: Repository<WalletEntity>,
    @InjectRepository(WalletTransactionEntity)
    private readonly walletTransactionRepository: Repository<WalletTransactionEntity>,
    @InjectRepository(CreditFacilityRequestEntity)
    private creditFacilityRepo: Repository<CreditFacilityRequestEntity>,
  ) {}
  async createWallet(userId: string): Promise<WalletEntity> {
    const wallet = this.walletRepository.create({ userId, balance: 0 });
    return this.walletRepository.save(wallet);
  }

  async getWalletByUserId(userId: string): Promise<WalletEntity> {
    const wallet = await this.walletRepository.findOne({ where: { userId } });
    if (!wallet) {
      this.createWallet(userId);
    }
    return wallet;
  }

  async creditWallet(userId: string, amount: number): Promise<WalletEntity> {
    const wallet = await this.getWalletByUserId(userId);
    wallet.balance += amount;
    await this.walletRepository.save(wallet);

    const transaction = this.walletTransactionRepository.create({
      userId,
      amount,
      transactionType: TransactionType.CREDIT,
      status: TransactionStatus.COMPLETED,
      wallet,
    });
    await this.walletTransactionRepository.save(transaction);

    return wallet;
  }

  async freezeWallet(userId: string): Promise<WalletEntity> {
    const wallet = await this.getWalletByUserId(userId);
    wallet.isFrozen = true;
    await this.walletRepository.save(wallet);

    return wallet;
  }

  async handleApprovedCredit(
    walletId: string,
    amount: number,
    transactionalEntityManager?: EntityManager,
  ): Promise<WalletEntity> {
    const walletRepo = transactionalEntityManager.getRepository(WalletEntity);
    const wallet = await walletRepo.findOne({
      where: { id: walletId },
      relations: ['transactions'],
    });
    if (!wallet) {
      throw new NotFoundException(`Wallet with ID ${walletId} not found`);
    }

    wallet.borrowedAmount = Number(wallet.borrowedAmount || 0) + amount;
    wallet.balance = Number(wallet.balance || 0) + amount;
    await this.walletRepository.save(wallet);

    const transaction = this.walletTransactionRepository.create({
      userId: wallet.userId,
      amount,
      transactionType: TransactionType.FACILITY_CREDIT,
      status: TransactionStatus.COMPLETED,
      wallet,
    });
    await this.walletTransactionRepository.save(transaction);

    return wallet;
  }

  async debitWallet(
    userId: string,
    amount: number,
    transactionalEntityManager?: EntityManager,
  ): Promise<WalletEntity> {
    console.log(`Debiting wallet for user ${userId} with amount ${amount}`);
    const walletRepo =
      transactionalEntityManager?.getRepository(WalletEntity) ||
      this.walletRepository;
    const wallet = await walletRepo.findOne({ where: { userId } });
    if (!wallet)
      throw new NotFoundException(`Wallet with user ID ${userId} not found`);

    if (wallet.isFrozen) throw new ConflictException('Wallet is frozen');

    if (wallet.balance < amount)
      throw new ConflictException('Insufficient balance');
    wallet.balance -= amount;
    await walletRepo.save(wallet);

    const transaction = this.walletTransactionRepository.create({
      userId,
      amount,
      transactionType: TransactionType.DEBIT,
      status: TransactionStatus.COMPLETED,
      wallet,
    });
    await this.walletTransactionRepository.save(transaction);

    return wallet;
  }

  async canSpendWithCredit(userId: string, amount: number): Promise<boolean> {
    const facility = await this.creditFacilityRepo.findOne({
      where: { user: { id: userId }, status: 'approved' },
      order: { creditStartDate: 'DESC' },
    });
    if (!facility) return false;

    const now = new Date();
    if (now < facility.creditStartDate || now > facility.creditEndDate)
      return false;

    const week = Math.floor(
      (now.getTime() - facility.creditStartDate.getTime()) /
        (14 * 24 * 60 * 60 * 1000),
    );
    const allowed = facility.approvedAmount / 3;

    // Sum all wallet transactions of type FACILITY_CREDIT for this user in this window
    const windowStart = new Date(
      facility.creditStartDate.getTime() + week * 14 * 24 * 60 * 60 * 1000,
    );
    const windowEnd = new Date(
      windowStart.getTime() + 14 * 24 * 60 * 60 * 1000,
    );

    const result = await this.walletTransactionRepository
      .createQueryBuilder('tx')
      .select('SUM(tx.amount)', 'total')
      .where('tx.userId = :userId', { userId })
      .andWhere('tx.transactionType = :type', { type: TransactionType.DEBIT })
      .andWhere('tx.createdAt BETWEEN :start AND :end', {
        start: windowStart,
        end: windowEnd,
      })
      .getRawOne();

    const spent = parseFloat(result.total) || 0;

    return spent + amount <= allowed;
  }
}
