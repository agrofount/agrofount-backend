import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AiSettingsService } from './ai-settings.service';

@Controller('ai-farm-assistant')
@ApiTags('AI Farm Assistant')
export class AiStatusController {
  constructor(private readonly aiSettingsService: AiSettingsService) {}

  @Get('status')
  @ApiOperation({ summary: 'Check whether Ayo AI is enabled on the marketplace' })
  async getStatus(): Promise<{ isActive: boolean }> {
    const isActive = await this.aiSettingsService.isAyoActive();
    return { isActive };
  }
}
