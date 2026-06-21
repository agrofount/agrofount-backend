import {
  Controller,
  Post,
  Body,
  HttpStatus,
  HttpException,
  Headers,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { AiChatService } from './services/ai-chat.service';
import {
  AiChatResponseDto,
  ChatRequestDto,
  ChatResponseDto,
} from './dto/ai-chat.dto';
import { ApiTags, ApiOperation, ApiHeader, ApiResponse } from '@nestjs/swagger';

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
          type: response.type,
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

  @Post('conversation/stream')
  @ApiOperation({
    summary: 'Stream veterinary chat conversation',
    description:
      'Processes user messages and streams the bot response as Server-Sent Events',
  })
  @ApiHeader({
    name: 'X-Session-Id',
    description: 'Optional existing session ID',
    required: false,
  })
  async streamMessage(
    @Body() chatRequest: ChatRequestDto,
    @Res() res: Response,
    @Headers('X-Session-Id') sessionId?: string,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    if (!chatRequest?.message?.trim()) {
      this.writeSse(res, 'error', {
        success: false,
        error: 'Message cannot be empty',
        timestamp: new Date().toISOString(),
      });
      res.end();
      return;
    }

    try {
      const effectiveSessionId = sessionId || this.generateSessionId();
      const response = await this.aiChatService.handleConversation(
        effectiveSessionId,
        chatRequest.message.trim(),
      );

      const metadata = {
        currentState: response.currentState,
        animalType: response.animalType,
        options: response.options,
        products: response.products,
        type: response.type,
        timestamp: new Date().toISOString(),
      };

      this.writeSse(res, 'start', {
        success: true,
        sessionId: effectiveSessionId,
        metadata,
      });

      for (const delta of this.chunkMessage(response.message || '')) {
        if (res.destroyed) {
          return;
        }
        this.writeSse(res, 'chunk', { delta });
        await this.sleep(10);
      }

      this.writeSse(res, 'done', {
        success: true,
        sessionId: effectiveSessionId,
        response: response.message,
        metadata,
      });
      res.end();
    } catch (error) {
      this.writeSse(res, 'error', {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      });
      res.end();
    }
  }

  private generateSessionId(): string {
    return `vet-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private writeSse(res: Response, event: string, data: unknown): void {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  private chunkMessage(message: string): string[] {
    return message.match(/\S+\s*/g) || [];
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
