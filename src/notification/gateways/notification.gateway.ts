import { DataSource, IsNull, MoreThan } from 'typeorm';
import { isNotificationExcluded } from '../utils/notification-exclusions';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { Server, Socket } from 'socket.io';
import { AdminEntity } from '../../admins/entities/admin.entity';
import { AuthSessionEntity } from '../../auth/entities/auth-session.entity';
import { UserEntity } from '../../user/entities/user.entity';

@WebSocketGateway({
  namespace: '/notifications',
  cors: {
    origin: (process.env.CORS_ORIGINS || 'http://localhost:3000')
      .split(',')
      .map((origin) => origin.trim()),
    credentials: false,
  },
})
export class NotificationGateway implements OnGatewayConnection {
  constructor(
    private readonly dataSource: DataSource,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}
  @WebSocketServer()
  server: Server;

  /**
   * Joins the socket to the room of the identity its access token proves,
   * and to nothing else. Same checks as the HTTP JwtStrategy and the upload
   * gateway: signature, issuer, audience, live session, verified account,
   * matching token version, and not logged out.
   */
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
      if (
        !payload.jti ||
        !payload.sid ||
        (await this.cacheManager.get(`auth:revoked:${payload.jti}`))
      ) {
        client.disconnect(true);
        return;
      }
      const session = await this.dataSource
        .getRepository(AuthSessionEntity)
        .findOne({
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
          ? await this.dataSource
              .getRepository(AdminEntity)
              .findOne({ where: { id: payload.id } })
          : await this.dataSource
              .getRepository(UserEntity)
              .findOne({ where: { id: payload.id } });
      if (
        !session ||
        !principal?.isVerified ||
        principal.tokenVersion !== payload.ver
      ) {
        client.disconnect(true);
        return;
      }
      client.data.userId = payload.id;
      await client.join(`user:${payload.id}`);
    } catch {
      client.disconnect(true);
    }
  }

  async emitToUser(userId: string, event: string, data: unknown) {
    if (await isNotificationExcluded(this.dataSource.manager, { userId }))
      return;
    this.server.to(`user:${userId}`).emit(event, data);
  }

  async broadcastToAll(event: string, data: unknown) {
    const sockets = await this.server.fetchSockets();
    for (const socket of sockets) {
      const userIds = [...socket.rooms]
        .filter((room) => room.startsWith('user:'))
        .map((room) => room.slice(5));
      if (!userIds.length) continue;
      const excluded = await Promise.all(
        userIds.map((userId) =>
          isNotificationExcluded(this.dataSource.manager, { userId }),
        ),
      );
      if (!excluded.some(Boolean)) socket.emit(event, data);
    }
  }
}
