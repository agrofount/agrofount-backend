import { Module } from '@nestjs/common';
import { UploadService } from './upload.service';
import { UploadController } from './upload.controller';
import { UploadGateway } from './upload.gateway';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UploadAssetEntity } from './entities/upload-asset.entity';
import { AuthSessionEntity } from '../auth/entities/auth-session.entity';
import { UserEntity } from '../user/entities/user.entity';
import { AdminEntity } from '../admins/entities/admin.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UploadAssetEntity,
      AuthSessionEntity,
      UserEntity,
      AdminEntity,
    ]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [UploadController],
  providers: [UploadService, UploadGateway],
  exports: [UploadService],
})
export class UploadModule {}
