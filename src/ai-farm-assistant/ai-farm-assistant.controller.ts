import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { SubmitFeedbackDto } from './dto/submit-feedback.dto';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserAuthGuard } from '../auth/guards/user.guard';
import { CurrentUser } from '../utils/decorators/current-user.decorator';
import { UserEntity } from '../user/entities/user.entity';
import { AskFarmAssistantDto } from './dto/ask-farm-assistant.dto';
import { AiFarmAssistantService } from './ai-farm-assistant.service';

@Controller('ai-farm-assistant')
@ApiTags('AI Farm Assistant')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, UserAuthGuard)
export class AiFarmAssistantController {
  constructor(private readonly farmAssistantService: AiFarmAssistantService) {}

  @Post('ask')
  @Throttle({ default: { limit: 20, ttl: 60 * 60 * 1000 } })
  @ApiOperation({ summary: 'Ask the AI farm assistant a question' })
  @ApiConsumes('multipart/form-data', 'application/json')
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: 5 * 1024 * 1024, files: 1 },
      fileFilter: (_req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        cb(null, allowed.includes(file.mimetype));
      },
    }),
  )
  ask(
    @CurrentUser() user: UserEntity,
    @Body() dto: AskFarmAssistantDto,
    @UploadedFile() image?: Express.Multer.File,
  ) {
    return this.farmAssistantService.ask(user.id, dto, image);
  }

  @Post('ask/stream')
  @Throttle({ default: { limit: 20, ttl: 60 * 60 * 1000 } })
  @ApiOperation({ summary: 'Ask the AI farm assistant and stream the reply' })
  async askStream(
    @CurrentUser() user: UserEntity,
    @Body() dto: AskFarmAssistantDto,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    try {
      const response = await this.farmAssistantService.ask(user.id, dto);

      this.writeSse(res, 'start', {
        success: true,
        conversationId: response.conversationId,
        quickReplies: response.quickReplies,
        suggestedProducts: response.suggestedProducts,
        requiresVetAttention: response.requiresVetAttention,
      });

      for (const delta of this.chunkMessage(response.reply || '')) {
        if (res.destroyed) {
          return;
        }
        this.writeSse(res, 'chunk', { delta });
        await this.sleep(10);
      }

      this.writeSse(res, 'done', response);
      res.end();
    } catch (error) {
      this.writeSse(res, 'error', {
        success: false,
        error: error.message || 'Unable to process assistant request',
        timestamp: new Date().toISOString(),
      });
      res.end();
    }
  }

  @Get('conversations')
  @ApiOperation({ summary: 'List my farm assistant conversations' })
  listConversations(@CurrentUser() user: UserEntity) {
    return this.farmAssistantService.listConversations(user.id);
  }

  @Get('conversations/:id')
  @ApiOperation({ summary: 'Get a farm assistant conversation' })
  getConversation(
    @CurrentUser() user: UserEntity,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.farmAssistantService.getConversation(user.id, id);
  }

  @Delete('conversations/:id')
  @ApiOperation({ summary: 'Delete a farm assistant conversation' })
  deleteConversation(
    @CurrentUser() user: UserEntity,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.farmAssistantService.deleteConversation(user.id, id);
  }

  @Post('conversations/:id/feedback')
  @ApiOperation({ summary: 'Submit thumbs-up or thumbs-down for a conversation' })
  submitFeedback(
    @CurrentUser() user: UserEntity,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitFeedbackDto,
  ) {
    return this.farmAssistantService.submitFeedback(user.id, id, dto);
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
