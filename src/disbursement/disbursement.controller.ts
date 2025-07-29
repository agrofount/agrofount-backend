import { Controller, Logger, Post } from '@nestjs/common';
import { DisbursementService } from './disbursement.service';
import { Cron } from '@nestjs/schedule';

@Controller('disbursements')
export class DisbursementController {
  private readonly logger = new Logger(DisbursementController.name);

  constructor(private readonly disbursementService: DisbursementService) {}

  @Cron('0 2 * * *')
  handleCron() {
    this.logger.debug('Processing pending disbursements...');
    return this.disbursementService.processPendingDisbursements();
  }
}
