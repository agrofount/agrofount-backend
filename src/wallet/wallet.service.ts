import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WalletEntity } from './entities/wallet.entity';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { WalletTransactionEntity } from './entities/wallet-transactions.entity';
import { TransactionStatus, TransactionType } from './types/wallet.type';
import { CreditFacilityRequestEntity } from '../credit-facility/entities/credit-facility.entity';
import {
  LedgerDirection,
  LedgerEntryEntity,
} from './entities/ledger-entry.entity';

@Injectable()
export class WalletService {
  constructor(
    @InjectRepository(WalletEntity)
    private readonly walletRepository: Repository<WalletEntity>,
    @InjectRepository(WalletTransactionEntity)
    private readonly walletTransactionRepository: Repository<WalletTransactionEntity>,
    @InjectRepository(CreditFacilityRequestEntity)
    private creditFacilityRepo: Repository<CreditFacilityRequestEntity>,
    private readonly dataSource: DataSource,
  ) {}
  async createWallet(
    userId: string,
    manager?: EntityManager,
  ): Promise<WalletEntity> {
    const walletRepo =
      manager?.getRepository(WalletEntity) || this.walletRepository;
    const existing = await walletRepo.findOne({ where: { userId } });
    if (existing) return existing;

    try {
      return await walletRepo.save(
        walletRepo.create({
          userId,
          balance: 0,
          balanceMinor: '0',
          borrowedAmount: 0,
          borrowedAmountMinor: '0',
        }),
      );
    } catch (error: any) {
      if (error?.code === '23505') {
        return walletRepo.findOneOrFail({ where: { userId } });
      }
      throw error;
    }
  }

  async getWalletByUserId(
    userId: string,
    manager?: EntityManager,
  ): Promise<WalletEntity> {
    const walletRepo =
      manager?.getRepository(WalletEntity) || this.walletRepository;
    return (
      (await walletRepo.findOne({ where: { userId } })) ||
      this.createWallet(userId, manager)
    );
  }

  async creditWallet(
    userId: string,
    amount: number,
    operationKey: string,
    referenceType?: string,
    referenceId?: string,
    manager?: EntityManager,
  ): Promise<WalletEntity> {
    this.assertValidAmount(amount);
    if (!manager) {
      return this.dataSource.transaction((transactionManager) =>
        this.creditWallet(
          userId,
          amount,
          operationKey,
          referenceType,
          referenceId,
          transactionManager,
        ),
      );
    }

    const walletRepo = manager.getRepository(WalletEntity);
    const transactionRepo = manager.getRepository(WalletTransactionEntity);
    await this.getWalletByUserId(userId, manager);
    const wallet = await walletRepo.findOne({
      where: { userId },
      lock: { mode: 'pessimistic_write' },
    });
    const existing = await transactionRepo.findOne({ where: { operationKey } });
    if (existing) return wallet;
    const amountMinor = this.toMinor(amount);
    const before = BigInt(wallet.balanceMinor || this.toMinor(wallet.balance));
    const after = before + amountMinor;
    wallet.balanceMinor = after.toString();
    wallet.balance = this.fromMinor(after);
    await walletRepo.save(wallet);

    const transaction = transactionRepo.create({
      userId,
      amount,
      amountMinor: amountMinor.toString(),
      operationKey,
      referenceType: referenceType || null,
      referenceId: referenceId || null,
      balanceBeforeMinor: before.toString(),
      balanceAfterMinor: after.toString(),
      transactionType: TransactionType.CREDIT,
      status: TransactionStatus.COMPLETED,
      wallet,
    });
    const savedTransaction = await transactionRepo.save(transaction);
    await this.recordBalancedJournal(
      manager,
      savedTransaction,
      { type: 'platform-clearing', id: referenceType || 'treasury' },
      { type: 'wallet-liability', id: wallet.id },
    );

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
    operationKey: string,
    referenceId: string,
    transactionalEntityManager?: EntityManager,
  ): Promise<WalletEntity> {
    this.assertValidAmount(amount);
    if (!transactionalEntityManager) {
      return this.dataSource.transaction((manager) =>
        this.handleApprovedCredit(
          walletId,
          amount,
          operationKey,
          referenceId,
          manager,
        ),
      );
    }
    const walletRepo = transactionalEntityManager.getRepository(WalletEntity);
    const transactionRepo = transactionalEntityManager.getRepository(
      WalletTransactionEntity,
    );
    const wallet = await walletRepo.findOne({
      where: { id: walletId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!wallet) {
      throw new NotFoundException(`Wallet with ID ${walletId} not found`);
    }

    const existing = await transactionRepo.findOne({ where: { operationKey } });
    if (existing) return wallet;

    const amountMinor = this.toMinor(amount);
    const before = BigInt(wallet.balanceMinor || this.toMinor(wallet.balance));
    const borrowedBefore = BigInt(
      wallet.borrowedAmountMinor || this.toMinor(wallet.borrowedAmount),
    );
    const after = before + amountMinor;
    wallet.balanceMinor = after.toString();
    wallet.balance = this.fromMinor(after);
    wallet.borrowedAmountMinor = (borrowedBefore + amountMinor).toString();
    wallet.borrowedAmount = this.fromMinor(borrowedBefore + amountMinor);
    await walletRepo.save(wallet);

    const transaction = transactionRepo.create({
      userId: wallet.userId,
      amount,
      amountMinor: amountMinor.toString(),
      operationKey,
      referenceType: 'credit-facility',
      referenceId,
      balanceBeforeMinor: before.toString(),
      balanceAfterMinor: after.toString(),
      transactionType: TransactionType.FACILITY_CREDIT,
      status: TransactionStatus.COMPLETED,
      wallet,
    });
    const savedTransaction = await transactionRepo.save(transaction);
    await this.recordBalancedJournal(
      transactionalEntityManager,
      savedTransaction,
      { type: 'credit-receivable', id: referenceId },
      { type: 'wallet-liability', id: wallet.id },
    );

    return wallet;
  }

  async debitWallet(
    userId: string,
    amount: number,
    operationKey: string,
    referenceType: string,
    referenceId: string,
    transactionalEntityManager?: EntityManager,
  ): Promise<WalletEntity> {
    this.assertValidAmount(amount);
    if (!transactionalEntityManager) {
      return this.dataSource.transaction((manager) =>
        this.debitWallet(
          userId,
          amount,
          operationKey,
          referenceType,
          referenceId,
          manager,
        ),
      );
    }
    const walletRepo = transactionalEntityManager.getRepository(WalletEntity);
    const transactionRepo = transactionalEntityManager.getRepository(
      WalletTransactionEntity,
    );
    const wallet = await walletRepo.findOne({
      where: { userId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!wallet)
      throw new NotFoundException(`Wallet with user ID ${userId} not found`);

    if (wallet.isFrozen) throw new ConflictException('Wallet is frozen');

    const existing = await transactionRepo.findOne({ where: { operationKey } });
    if (existing) return wallet;

    const amountMinor = this.toMinor(amount);
    const before = BigInt(wallet.balanceMinor || this.toMinor(wallet.balance));
    if (before < amountMinor)
      throw new ConflictException('Insufficient balance');
    const after = before - amountMinor;
    wallet.balanceMinor = after.toString();
    wallet.balance = this.fromMinor(after);
    await walletRepo.save(wallet);

    const transaction = transactionRepo.create({
      userId,
      amount,
      amountMinor: amountMinor.toString(),
      operationKey,
      referenceType,
      referenceId,
      balanceBeforeMinor: before.toString(),
      balanceAfterMinor: after.toString(),
      transactionType: TransactionType.DEBIT,
      status: TransactionStatus.COMPLETED,
      wallet,
    });
    const savedTransaction = await transactionRepo.save(transaction);
    await this.recordBalancedJournal(
      transactionalEntityManager,
      savedTransaction,
      { type: 'wallet-liability', id: wallet.id },
      { type: 'platform-clearing', id: referenceId },
    );

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

  private assertValidAmount(amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Amount must be greater than zero');
    }
  }

  private async recordBalancedJournal(
    manager: EntityManager,
    transaction: WalletTransactionEntity,
    debitAccount: { type: string; id: string },
    creditAccount: { type: string; id: string },
  ): Promise<void> {
    const repository = manager.getRepository(LedgerEntryEntity);
    const common = {
      operationKey: transaction.operationKey as string,
      amountMinor: transaction.amountMinor as string,
      currency: 'NGN',
      referenceType: transaction.referenceType,
      referenceId: transaction.referenceId,
      walletTransactionId: transaction.id,
    };
    await repository.save([
      repository.create({
        ...common,
        lineNumber: 1,
        accountType: debitAccount.type,
        accountId: debitAccount.id,
        direction: LedgerDirection.Debit,
      }),
      repository.create({
        ...common,
        lineNumber: 2,
        accountType: creditAccount.type,
        accountId: creditAccount.id,
        direction: LedgerDirection.Credit,
      }),
    ]);
  }

  private toMinor(amount: number): bigint {
    this.assertValidAmount(amount);
    return BigInt(Math.round(amount * 100));
  }

  private fromMinor(amount: bigint): number {
    return Number(amount) / 100;
  }
}
