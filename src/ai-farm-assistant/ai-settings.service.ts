import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiSettingsEntity } from './entities/ai-settings.entity';
import { UpdateAiSettingsDto } from './dto/ai-settings-update.dto';

const SETTINGS_ID = 1;

@Injectable()
export class AiSettingsService {
  private readonly logger = new Logger(AiSettingsService.name);

  constructor(
    @InjectRepository(AiSettingsEntity)
    private readonly settingsRepository: Repository<AiSettingsEntity>,
  ) {}

  async getSettings(): Promise<AiSettingsEntity> {
    let settings = await this.settingsRepository.findOne({
      where: { id: SETTINGS_ID },
    });

    if (!settings) {
      settings = await this.settingsRepository.save(
        this.settingsRepository.create({ id: SETTINGS_ID }),
      );
    }

    return settings;
  }

  async updateSettings(
    dto: UpdateAiSettingsDto,
    updatedBy?: string,
  ): Promise<AiSettingsEntity> {
    const settings = await this.getSettings();

    if (dto.isActive !== undefined) settings.isActive = dto.isActive;
    if (dto.monthlyBudgetUSD !== undefined)
      settings.monthlyBudgetUSD = dto.monthlyBudgetUSD ?? null;
    if (dto.costPer1MInputTokensUSD !== undefined)
      settings.costPer1MInputTokensUSD = dto.costPer1MInputTokensUSD;
    if (dto.costPer1MOutputTokensUSD !== undefined)
      settings.costPer1MOutputTokensUSD = dto.costPer1MOutputTokensUSD;
    if (updatedBy) settings.updatedBy = updatedBy;

    return this.settingsRepository.save(settings);
  }

  async isAyoActive(): Promise<boolean> {
    try {
      const settings = await this.getSettings();
      return settings.isActive;
    } catch (err) {
      this.logger.warn('Could not read ai_settings — defaulting to active', err);
      return true;
    }
  }
}
