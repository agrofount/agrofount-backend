import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import { MessageEntity } from './entities/message.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SendInBlueModule } from './modules/sendinblue.module';
import { HttpModule } from '@nestjs/axios';
import { AfricasTalkingModule } from './modules/africasTalking.module';
import { TeamsService } from './services/teams.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([MessageEntity]),
    SendInBlueModule,
    AfricasTalkingModule,
    HttpModule,
  ],
  controllers: [NotificationController],
  providers: [NotificationService, TeamsService],
  exports: [NotificationService],
})
export class NotificationModule {}
