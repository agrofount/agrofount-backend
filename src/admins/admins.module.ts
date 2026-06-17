import { Module } from '@nestjs/common';
import { AdminsService } from './admins.service';
import { AdminsController } from './admins.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminEntity } from './entities/admin.entity';
import { NotificationModule } from '../notification/notification.module';
import { PassportModule } from '@nestjs/passport';
import { AdminStrategy } from '../auth/strategy/admin.strategy';
import { RoleEntity } from '../role/entities/role.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([AdminEntity, RoleEntity]),
    PassportModule,
    NotificationModule,
  ],
  controllers: [AdminsController],
  providers: [AdminsService, AdminStrategy],
  exports: [AdminsService],
})
export class AdminsModule {}
