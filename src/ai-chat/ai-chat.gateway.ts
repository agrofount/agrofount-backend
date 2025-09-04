import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AiChatService } from './services/ai-chat.service';

@WebSocketGateway({ namespace: '/ai-chat', cors: true })
export class AiChatGateway {
  @WebSocketServer()
  server: Server;

  constructor(private readonly aiChatService: AiChatService) {}

  @SubscribeMessage('user_message')
  async handleUserMessage(
    @MessageBody() data: { userId: string; message: string },
    @ConnectedSocket() client: Socket,
  ) {
    const response = await this.aiChatService.processUserMessage(
      data.userId,
      data.message,
    );
    client.emit('ai_response', response);
  }
}
