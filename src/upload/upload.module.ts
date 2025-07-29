import { Module } from '@nestjs/common';
import { UploadService } from './upload.service';
import { UploadController } from './upload.controller';
import { UploadGateway } from './upload.gateway';

@Module({
  controllers: [UploadController],
  providers: [UploadService, UploadGateway],
})
export class UploadModule {}
