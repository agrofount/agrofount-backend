import { InjectRepository } from '@nestjs/typeorm';
import { CreditAssessmentEntity } from './entities/credit-assessment.entity';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { WalletService } from '../wallet/wallet.service';

@Injectable()
export class CreditAssessmentService {
  constructor(
    @InjectRepository(CreditAssessmentEntity)
    private assessmentRepo: Repository<CreditAssessmentEntity>,
    private readonly walletService: WalletService,
  ) {}

  async assessUser(userId: string) {
    const wallet = await this.walletService.getWalletByUserId(userId);
    if (!wallet) throw new NotFoundException('Wallet not found');

    const totalSpending = wallet.borrowedAmount + wallet.balance; // Example calculation
    const repaymentRate = this.calculateRepaymentRate(userId); // Mock or real data

    const isEligible = repaymentRate >= 75 && totalSpending > 1000; // Example criteria

    const assessment = this.assessmentRepo.create({
      user: { id: userId },
      totalSpending,
      repaymentRate,
      isEligible,
      comments: isEligible
        ? 'User meets the eligibility criteria'
        : 'User does not meet the eligibility criteria',
    });

    return this.assessmentRepo.save(assessment);
  }

  private calculateRepaymentRate(userId: string): number {
    // Mock logic or real calculation
    console.log(userId);
    return Math.random() * 100; // Replace with real repayment data
  }
}
