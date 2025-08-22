import {
  Controller,
  Post,
  Body,
  Session,
  HttpStatus,
  HttpException,
  Headers,
} from '@nestjs/common';
import { AiChatService } from './ai-chat.service';
import {
  AiChatMessageDto,
  AiChatResponseDto,
  ChatRequestDto,
  ChatResponseDto,
} from './dto/ai-chat.dto';
import {
  ApiTags,
  ApiOperation,
  ApiBody,
  ApiHeader,
  ApiResponse,
} from '@nestjs/swagger';

@ApiTags('AI Chat')
@Controller('ai-chat')
export class AiChatController {
  constructor(private readonly aiChatService: AiChatService) {}

  @Post('conversation')
  @ApiOperation({
    summary: 'Handle veterinary chat conversation',
    description: 'Processes user messages and maintains conversation state',
  })
  @ApiHeader({
    name: 'X-Session-Id',
    description: 'Optional existing session ID',
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: 'Successful conversation response',
    type: AiChatResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request payload',
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error',
  })
  async handleMessage(
    @Body() chatRequest: ChatRequestDto,
    @Headers('X-Session-Id') sessionId?: string,
  ): Promise<ChatResponseDto> {
    // Validate input
    if (!chatRequest?.message?.trim()) {
      throw new HttpException(
        'Message cannot be empty',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      // Generate new session ID if none provided
      const effectiveSessionId = sessionId || this.generateSessionId();

      // Process the conversation
      const response = await this.aiChatService.handleConversation(
        effectiveSessionId,
        chatRequest.message.trim(),
      );

      return {
        success: true,
        sessionId: effectiveSessionId,
        response: response.message,
        metadata: {
          currentState: response.currentState,
          animalType: response.animalType,
          options: response.options,
          products: response.products,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error) {
      throw new HttpException(
        {
          success: false,
          error: error.message,
          timestamp: new Date().toISOString(),
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private generateSessionId(): string {
    return `vet-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
