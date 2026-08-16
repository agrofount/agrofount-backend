import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LeadEntity } from './entities/lead.entity';
import { LeadsService } from './leads.service';
import { LeadsController } from './leads.controller';
import { LeadCaptureController } from './lead-capture.controller';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [TypeOrmModule.forFeature([LeadEntity]), NotificationModule],
  controllers: [LeadsController, LeadCaptureController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
