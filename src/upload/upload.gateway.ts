import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { AdminEntity } from '../admins/entities/admin.entity';
import { AuthSessionEntity } from '../auth/entities/auth-session.entity';
import { UserEntity } from '../user/entities/user.entity';

@WebSocketGateway({
  cors: {
    origin: (process.env.CORS_ORIGINS || 'http://localhost:3000')
      .split(',')
      .map((origin) => origin.trim()),
    credentials: false,
  },
})
export class UploadGateway implements OnGatewayConnection {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectRepository(AuthSessionEntity)
    private readonly sessionRepository: Repository<AuthSessionEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(AdminEntity)
    private readonly adminRepository: Repository<AdminEntity>,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    const authorization = client.handshake.headers.authorization;
    const token =
      client.handshake.auth?.token ||
      (authorization?.startsWith('Bearer ') ? authorization.slice(7) : null);
    if (!token) {
      client.disconnect(true);
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync(token, {
        issuer: this.configService.get<string>('JWT_ISSUER') || 'agrofount-api',
        audience:
          this.configService.get<string>('JWT_AUDIENCE') || 'agrofount-client',
        algorithms: ['HS256'],
      });
      const session = await this.sessionRepository.findOne({
        where: {
          id: payload.sid,
          principalId: payload.id,
          principalType: payload.principalType,
          expiresAt: MoreThan(new Date()),
          revokedAt: IsNull(),
        },
      });
      const principal =
        payload.principalType === 'admin'
          ? await this.adminRepository.findOne({ where: { id: payload.id } })
          : await this.userRepository.findOne({ where: { id: payload.id } });
      if (
        !session ||
        !principal?.isVerified ||
        principal.tokenVersion !== payload.ver
      ) {
        client.disconnect(true);
        return;
      }
      client.data.userId = payload.id;
      await client.join(`upload:${payload.id}`);
    } catch {
      client.disconnect(true);
    }
  }

  getServer(): Server {
    return this.server;
  }
}
