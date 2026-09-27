import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportRunEntity } from './entities/report-run.entity';
import { ReportScheduleEntity } from './entities/report-schedule.entity';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ReportRunEntity, ReportScheduleEntity]),
    NotificationModule,
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
