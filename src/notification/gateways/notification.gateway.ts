import { DataSource } from 'typeorm';
import { isNotificationExcluded } from '../utils/notification-exclusions';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({ namespace: '/notifications', cors: true })
export class NotificationGateway {
  constructor(private readonly dataSource: DataSource) {}
  @WebSocketServer()
  server: Server;

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

  @SubscribeMessage('subscribe')
  handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userId: string },
  ) {
    if (data?.userId) {
      client.join(`user:${data.userId}`);
    }
  }
}
