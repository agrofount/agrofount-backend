import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LeadEntity } from './entities/lead.entity';
import { LeadNoteEntity } from './entities/lead-note.entity';
import { LeadOwnershipService } from './lead-ownership.service';
import { LeadsService } from './leads.service';
import { LeadsController } from './leads.controller';
import { LeadCaptureController } from './lead-capture.controller';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([LeadEntity, LeadNoteEntity]),
    NotificationModule,
  ],
  controllers: [LeadsController, LeadCaptureController],
  providers: [LeadsService, LeadOwnershipService],
  exports: [LeadsService, LeadOwnershipService],
})
export class LeadsModule {}
