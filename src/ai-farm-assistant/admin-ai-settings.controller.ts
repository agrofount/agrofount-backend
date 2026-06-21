import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminAuthGuard } from '../auth/guards/admin.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequiredPermissions } from '../auth/decorator/required-permission.decorator';
import { AiSettingsService } from './ai-settings.service';
import { UpdateAiSettingsDto } from './dto/ai-settings-update.dto';

@Controller('admin/ai-settings')
@ApiTags('Admin AI Settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
export class AdminAiSettingsController {
  constructor(private readonly aiSettingsService: AiSettingsService) {}

  @Get()
  @RequiredPermissions('read_ai_analytics')
  @ApiOperation({
    summary:
      'Get Ayo AI settings — active state, provider, model, monthly budget',
  })
  getSettings() {
    return this.aiSettingsService.getSettings();
  }

  @Patch()
  @RequiredPermissions('manage_ai_settings')
  @ApiOperation({
    summary:
      'Update Ayo AI settings — toggle active state, set budget or token cost rates',
  })
  updateSettings(@Body() dto: UpdateAiSettingsDto) {
    return this.aiSettingsService.updateSettings(dto);
  }
}
