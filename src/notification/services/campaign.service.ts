import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  CampaignAudience,
  CampaignFrequency,
  CampaignStatus,
  NotificationCampaignEntity,
} from '../entities/notification-campaign.entity';
import { CreateCampaignDto } from '../dto/create-campaign.dto';
import { UserEntity } from '../../user/entities/user.entity';
import { BusinessType, UserTypes } from '../../auth/enums/role.enum';

@Injectable()
export class CampaignService {
  constructor(
    @InjectRepository(NotificationCampaignEntity)
    private readonly campaignRepo: Repository<NotificationCampaignEntity>,
    @InjectQueue('notification-campaigns')
    private readonly campaignQueue: Queue,
    private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreateCampaignDto, createdBy?: string) {
    const campaign = this.campaignRepo.create({
      title: dto.title,
      message: dto.message,
      category: dto.category,
      channels: dto.channels,
      audience: dto.audience ?? { all: true },
      ctaText: dto.ctaText,
      ctaLink: dto.ctaLink,
      bannerImageUrl: dto.bannerImageUrl,
      emailContent: dto.emailContent,
      scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
      frequency: dto.frequency,
      status: CampaignStatus.DRAFT,
      createdBy,
    });

    const saved = await this.campaignRepo.save(campaign);
    await this.dispatch(saved);
    return saved;
  }

  async findAll(status?: string): Promise<NotificationCampaignEntity[]> {
    return this.campaignRepo.find({
      where: status ? { status: status as CampaignStatus } : undefined,
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }

  async findOne(id: string): Promise<NotificationCampaignEntity> {
    const campaign = await this.campaignRepo.findOne({ where: { id } });
    if (!campaign) throw new NotFoundException('Campaign not found');
    return campaign;
  }

  async getStats() {
    const [total, scheduled, sent, failed] = await Promise.all([
      this.campaignRepo.count(),
      this.campaignRepo.count({ where: { status: CampaignStatus.SCHEDULED } }),
      this.campaignRepo.count({ where: { status: CampaignStatus.SENT } }),
      this.campaignRepo.count({ where: { status: CampaignStatus.FAILED } }),
    ]);

    const agg = await this.campaignRepo
      .createQueryBuilder('c')
      .select('SUM(c.totalSent)', 'totalSent')
      .addSelect('SUM(c.totalDelivered)', 'totalDelivered')
      .addSelect('SUM(c.totalFailed)', 'totalFailed')
      .getRawOne();

    const totalSent = parseInt(agg?.totalSent ?? '0', 10);
    const totalDelivered = parseInt(agg?.totalDelivered ?? '0', 10);
    const openRate =
      totalSent > 0 ? Math.round((totalDelivered / totalSent) * 100) : 0;

    return {
      campaigns: total,
      scheduled,
      sent,
      failed,
      totalSent,
      totalDelivered,
      openRate,
    };
  }

  async resolveAudience(audience: CampaignAudience): Promise<UserEntity[]> {
    const query = this.dataSource
      .createQueryBuilder(UserEntity, 'user')
      .where('user.deletedAt IS NULL');

    if (!audience?.all) {
      if (audience?.states?.length) {
        query.andWhere('user.state IN (:...states)', {
          states: audience.states,
        });
      }
      const validBT = Object.values(BusinessType);
      const safeBT = (audience.businessTypes ?? []).filter((t) =>
        validBT.includes(t as BusinessType),
      );
      if (safeBT.length) {
        query.andWhere('user.businessType IN (:...businessTypes)', {
          businessTypes: safeBT,
        });
      }
      if (audience?.isVerified !== undefined) {
        query.andWhere('user.isVerified = :isVerified', {
          isVerified: audience.isVerified,
        });
      }
      const validUT = Object.values(UserTypes);
      const safeUT = (audience.userTypes ?? []).filter((t) =>
        validUT.includes(t as UserTypes),
      );
      if (safeUT.length) {
        query.andWhere('user.userType IN (:...userTypes)', {
          userTypes: safeUT,
        });
      }
    }

    return query
      .select(['user.id', 'user.email', 'user.phone', 'user.firstname'])
      .getMany();
  }

  async markSent(
    id: string,
    stats: {
      totalRecipients: number;
      totalSent: number;
      totalDelivered: number;
      totalFailed: number;
    },
  ) {
    await this.campaignRepo.update(id, {
      ...stats,
      status: CampaignStatus.SENT,
    });
  }

  async markFailed(id: string) {
    await this.campaignRepo.update(id, { status: CampaignStatus.FAILED });
  }

  async estimateAudience(
    audience: CampaignAudience,
  ): Promise<{ count: number }> {
    const query = this.dataSource
      .createQueryBuilder(UserEntity, 'user')
      .where('user.deletedAt IS NULL');

    if (!audience?.all) {
      if (audience?.states?.length) {
        query.andWhere('user.state IN (:...states)', {
          states: audience.states,
        });
      }
      const validBT = Object.values(BusinessType);
      const safeBT = (audience.businessTypes ?? []).filter((t) =>
        validBT.includes(t as BusinessType),
      );
      if (safeBT.length) {
        query.andWhere('user.businessType IN (:...businessTypes)', {
          businessTypes: safeBT,
        });
      }
      if (audience?.isVerified !== undefined) {
        query.andWhere('user.isVerified = :isVerified', {
          isVerified: audience.isVerified,
        });
      }
      const validUT = Object.values(UserTypes);
      const safeUT = (audience.userTypes ?? []).filter((t) =>
        validUT.includes(t as UserTypes),
      );
      if (safeUT.length) {
        query.andWhere('user.userType IN (:...userTypes)', {
          userTypes: safeUT,
        });
      }
    }

    const count = await query.getCount();
    return { count };
  }

  private async dispatch(campaign: NotificationCampaignEntity) {
    const now = new Date();
    const scheduledAt = campaign.scheduledAt;

    if (scheduledAt && scheduledAt > now) {
      const delay = scheduledAt.getTime() - now.getTime();

      if (campaign.frequency && campaign.frequency !== CampaignFrequency.ONCE) {
        const pattern = this.frequencyToCron(campaign.frequency);
        if (pattern) {
          await this.campaignQueue.add(
            'send-campaign',
            { campaignId: campaign.id },
            {
              repeat: { pattern },
              attempts: 3,
              backoff: { type: 'exponential', delay: 2000 },
            },
          );
          await this.campaignRepo.update(campaign.id, {
            status: CampaignStatus.SCHEDULED,
          });
          return;
        }
      }

      await this.campaignQueue.add(
        'send-campaign',
        { campaignId: campaign.id },
        {
          delay,
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
        },
      );
      await this.campaignRepo.update(campaign.id, {
        status: CampaignStatus.SCHEDULED,
      });
    } else {
      await this.campaignQueue.add(
        'send-campaign',
        { campaignId: campaign.id },
        { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
      );
    }
  }

  private frequencyToCron(frequency: CampaignFrequency): string | null {
    switch (frequency) {
      case CampaignFrequency.DAILY:
        return '0 9 * * *';
      case CampaignFrequency.WEEKLY:
        return '0 9 * * 1';
      case CampaignFrequency.MONTHLY:
        return '0 9 1 * *';
      default:
        return null;
    }
  }
}
