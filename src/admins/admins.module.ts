import { Module } from '@nestjs/common';
import { AdminsService } from './admins.service';
import { AdminsController } from './admins.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminEntity } from './entities/admin.entity';
import { NotificationModule } from '../notification/notification.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AdminStrategy } from '../auth/strategy/admin.strategy';
import { RoleEntity } from 'src/role/entities/role.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([AdminEntity, RoleEntity]),
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_ADMIN_SECRET'),
        signOptions: { expiresIn: '60m' },
      }),
      inject: [ConfigService],
    }),
    NotificationModule,
  ],
  controllers: [AdminsController],
  providers: [AdminsService, AdminStrategy],
  exports: [AdminsService],
})
export class AdminsModule {}
