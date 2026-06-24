import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminAuthGuard } from '../../auth/guards/admin.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { RequiredPermissions } from '../../auth/decorator/required-permission.decorator';
import { IngestKnowledgeDocumentDto, RagSearchDto } from '../dto/knowledge.dto';
import { AiRagService } from '../services/ai-rag.service';

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

  @Get('search')
  @RequiredPermissions('read_ai_analytics')
  @ApiOperation({ summary: 'Search Ayo RAG knowledge with citations' })
  search(@Query() query: RagSearchDto) {
    return this.ragService.search(query);
  }
}
