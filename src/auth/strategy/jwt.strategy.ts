import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from '../../user/entities/user.entity';
import { AdminEntity } from '../../admins/entities/admin.entity';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { AuthSessionEntity } from '../entities/auth-session.entity';
import { IsNull, MoreThan } from 'typeorm';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(AdminEntity)
    private readonly adminRepository: Repository<AdminEntity>,
    @InjectRepository(AuthSessionEntity)
    private readonly sessionRepository: Repository<AuthSessionEntity>,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get('JWT_SECRET'),
      issuer: configService.get<string>('JWT_ISSUER') || 'agrofount-api',
      audience: configService.get<string>('JWT_AUDIENCE') || 'agrofount-client',
      algorithms: ['HS256'],
    });
  }

  async validate(payload: any) {
    if (
      !payload.jti ||
      !payload.sid ||
      !Number.isInteger(payload.ver) ||
      (await this.cacheManager.get(`auth:revoked:${payload.jti}`))
    ) {
      throw new UnauthorizedException('Session is no longer valid');
    }

    const session = await this.sessionRepository.findOne({
      where: {
        id: payload.sid,
        principalId: payload.id,
        principalType: payload.principalType,
        revokedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
    });
    if (!session || session.tokenVersion !== payload.ver) {
      throw new UnauthorizedException('Session is no longer valid');
    }

    if (payload.principalType === 'admin') {
      const admin = await this.adminRepository.findOne({
        where: { id: payload.id, isVerified: true },
        relations: ['roles'],
      });
      if (!admin) throw new UnauthorizedException('Account is unavailable');
      if ((admin.tokenVersion || 0) !== payload.ver) {
        throw new UnauthorizedException('Session is no longer valid');
      }
      const principal: any = { ...admin };
      delete principal.password;
      delete principal.verificationToken;
      delete principal.verificationTokenExpires;
      return {
        ...principal,
        principalType: 'admin',
        tokenId: payload.jti,
        tokenExpiresAt: payload.exp,
        tokenIssuedAt: payload.iat,
        sessionId: payload.sid,
      };
    }

    const user = await this.userRepository.findOne({
      where: { id: payload.id, isVerified: true },
    });
    if (!user) throw new UnauthorizedException('Account is unavailable');
    if ((user.tokenVersion || 0) !== payload.ver) {
      throw new UnauthorizedException('Session is no longer valid');
    }
    const principal: any = { ...user };
    delete principal.password;
    delete principal.verificationToken;
    delete principal.verificationTokenExpires;
    delete principal.resetToken;
    delete principal.resetTokenExpires;
    return {
      ...principal,
      principalType: 'user',
      tokenId: payload.jti,
      tokenExpiresAt: payload.exp,
      tokenIssuedAt: payload.iat,
      sessionId: payload.sid,
    };
  }
}
