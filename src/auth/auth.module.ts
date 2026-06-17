import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from '../user/entities/user.entity';
import { LocalStrategy } from './strategy/local.strategy';
import { JwtStrategy } from './strategy/jwt.strategy';
import { NotificationModule } from '../notification/notification.module';
import { VoucherModule } from '../voucher/voucher.module';
import { WalletModule } from '../wallet/wallet.module';
import { AdminEntity } from '../admins/entities/admin.entity';
import { AuthSessionEntity } from './entities/auth-session.entity';
import type { SignOptions } from 'jsonwebtoken';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity, AdminEntity, AuthSessionEntity]),
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: (configService.get<string>('JWT_EXPIRATION') ||
            '15m') as SignOptions['expiresIn'],
          issuer: configService.get<string>('JWT_ISSUER') || 'agrofount-api',
          audience:
            configService.get<string>('JWT_AUDIENCE') || 'agrofount-client',
          algorithm: 'HS256',
        },
      }),
      inject: [ConfigService],
    }),
    NotificationModule,
    VoucherModule,
    WalletModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, LocalStrategy, JwtStrategy],
})
export class AuthModule {}
