import { Module } from '@nestjs/common';
import { UserModule } from '../user/user.module';
import { AdminsModule } from '../admins/admins.module';
import { AiChatController } from './ai-chat.controller';
import { ProductLocationModule } from 'src/product-location/product-location.module';
import { AiChatGateway } from './ai-chat.gateway';
import { AiChatService } from './ai-chat.service';

@Module({
  imports: [ProductLocationModule, UserModule, AdminsModule],
  providers: [AiChatService, AiChatGateway],
  controllers: [AiChatController],
})
export class AiChatModule {}
