import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminAuthGuard } from '../../auth/guards/admin.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { RequiredPermissions } from '../../auth/decorator/required-permission.decorator';
import {
  IngestKnowledgeDocumentDto,
  PdfIngestDto,
  RagSearchDto,
} from '../dto/knowledge.dto';
import { AiRagService } from '../services/ai-rag.service';

const PDF_MAX_BYTES = 30 * 1024 * 1024; // 30 MB

@Controller('admin/ai-knowledge')
@ApiTags('Admin AI Knowledge')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
export class AdminAiKnowledgeController {
  constructor(private readonly ragService: AiRagService) {}

  @Post('documents')
  @RequiredPermissions('manage_ai_settings')
  @ApiOperation({ summary: 'Ingest a knowledge document into Ayo RAG' })
  ingest(@Body() dto: IngestKnowledgeDocumentDto) {
    return this.ragService.ingestDocument(dto);
  }

  @Post('upload-pdf')
  @RequiredPermissions('manage_ai_settings')
  @ApiOperation({ summary: 'Upload a PDF textbook and ingest it into Ayo RAG' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'sourceType'],
      properties: {
        file: { type: 'string', format: 'binary' },
        sourceType: {
          type: 'string',
          enum: ['farming', 'agrofount', 'market'],
        },
        title: { type: 'string' },
        externalId: { type: 'string' },
        tagsJson: {
          type: 'string',
          description: 'JSON array of tag strings, e.g. ["broiler","disease"]',
        },
        metadataJson: {
          type: 'string',
          description: 'JSON object of extra metadata',
        },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: PDF_MAX_BYTES },
      fileFilter: (_req, file, cb) => {
        if (
          file.mimetype !== 'application/pdf' &&
          !file.originalname.toLowerCase().endsWith('.pdf')
        ) {
          return cb(
            new BadRequestException('Only PDF files are accepted'),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  uploadPdf(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: PdfIngestDto,
  ) {
    if (!file) throw new BadRequestException('No PDF file was uploaded');
    return this.ragService.ingestPdfDocument(
      file.buffer,
      dto,
      file.originalname,
    );
  }

  @Get('search')
  @RequiredPermissions('read_ai_analytics')
  @ApiOperation({ summary: 'Search Ayo RAG knowledge with citations' })
  search(@Query() query: RagSearchDto) {
    return this.ragService.search(query);
  }
}
