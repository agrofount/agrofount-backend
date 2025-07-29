import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { UploadService } from './upload.service';

@WebSocketGateway({
  cors: {
    origin: '*', // Allow all origins (update this for production)
  },
})
export class UploadGateway {
  @WebSocketServer()
  server: Server;

  constructor(private readonly uploadService: UploadService) {}

  @SubscribeMessage('uploadFile')
  async handleFileUpload(
    @MessageBody() data: { file: Buffer; fileName: string },
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    const { file, fileName } = data;
    const clientId = client.id;

    try {
      const imageUrl = await this.uploadService.upload(
        fileName,
        file,
        clientId,
        this.server,
      );
      client.emit('uploadComplete', { imageUrl });
    } catch (error) {
      console.error('Error during upload:', error);
      client.emit('uploadError', { error: 'File upload failed' });
    }
  }

  getServer(): Server {
    return this.server;
  }
}
