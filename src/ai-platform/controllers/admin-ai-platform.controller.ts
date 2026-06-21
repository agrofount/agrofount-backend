import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminAuthGuard } from '../../auth/guards/admin.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { RequiredPermissions } from '../../auth/decorator/required-permission.decorator';
import { AyoRouterService } from '../services/ayo-router.service';

@Controller('admin/ai-platform')
@ApiTags('Admin AI Platform')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
export class AdminAiPlatformController {
  constructor(private readonly ayoRouterService: AyoRouterService) {}

  @Get('architecture')
  @RequiredPermissions('read_ai_analytics')
  @ApiOperation({
    summary: 'Current Ayo platform architecture and rollout state',
  })
  architecture() {
    return {
      success: true,
      layers: {
        gateway: 'AyoGatewayController',
        router: 'AyoRouterService',
        rag: 'AiRagService with persistent documents, chunks, citations',
        tools:
          'AiToolRegistryService with permission-checked business data tools',
        workflows: 'Workflow run persistence and deterministic routing hooks',
        agents: 'Agent run persistence and route selection',
        analytics: 'Tool, RAG, workflow, and agent telemetry tables',
      },
      rolloutState: {
        existingAssistant: '/ai-farm-assistant/* remains active',
        newGateway: '/ayo/gateway is available for staged clients',
        legacyChat: '/ai-chat/* remains disabled in AppModule',
      },
      capabilities: this.ayoRouterService.listCapabilities('admin'),
    };
  }
}
