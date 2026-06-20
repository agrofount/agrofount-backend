import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UploadModule } from '../upload/upload.module';
import { OutboxModule } from '../outbox/outbox.module';
import { CareersController } from './careers.controller';
import { AdminCareersController } from './admin-careers.controller';
import { CareersService } from './careers.service';
import { CareerJobEntity } from './entities/career-job.entity';
import { JobApplicationEntity } from './entities/job-application.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([CareerJobEntity, JobApplicationEntity]),
    UploadModule,
    OutboxModule,
  ],
  controllers: [CareersController, AdminCareersController],
  providers: [CareersService],
  exports: [CareersService],
})
export class CareersModule {}
