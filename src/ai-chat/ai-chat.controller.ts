import { Controller, Post, Body } from '@nestjs/common';
import { AiChatService } from './ai-chat.service';
import { AiChatMessageDto, AiChatResponseDto } from './dto/ai-chat.dto';
import { ApiTags, ApiOperation, ApiBody } from '@nestjs/swagger';

@ApiTags('AI Chat')
@Controller('ai-chat')
export class AiChatController {
  constructor(private readonly aiChatService: AiChatService) {}

  @Post('message')
  @ApiOperation({ summary: 'Send a message to the AI chat assistant' })
  @ApiBody({ type: AiChatMessageDto })
  async sendMessage(
    @Body() body: AiChatMessageDto,
  ): Promise<AiChatResponseDto> {
    return this.aiChatService.processUserMessage(body.userId, body.message);
  }
}
