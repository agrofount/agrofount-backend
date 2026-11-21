import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LeadEntity } from './entities/lead.entity';
import { LeadNoteEntity } from './entities/lead-note.entity';
import { LeadActivityEntity } from './entities/lead-activity.entity';
import { LeadOwnerHistoryEntity } from './entities/lead-owner-history.entity';
import { LeadStageHistoryEntity } from './entities/lead-stage-history.entity';
import { CommissionRateEntity } from './entities/commission-rate.entity';
import { StaffTargetEntity } from './entities/staff-target.entity';
import { LeadActivityService } from './lead-activity.service';
import { LeadOwnershipService } from './lead-ownership.service';
import { LeadsService } from './leads.service';
import { LeadsController } from './leads.controller';
import { LeadCaptureController } from './lead-capture.controller';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      LeadEntity,
      LeadNoteEntity,
      LeadActivityEntity,
      LeadOwnerHistoryEntity,
      LeadStageHistoryEntity,
      CommissionRateEntity,
      StaffTargetEntity,
    ]),
    NotificationModule,
  ],
  controllers: [LeadsController, LeadCaptureController],
  providers: [LeadsService, LeadOwnershipService, LeadActivityService],
  exports: [LeadsService, LeadOwnershipService, LeadActivityService],
})
export class LeadsModule {}
