import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { CronJobConfigEntity } from '../entities/cron-job-config.entity';
import { CronJobRunEntity } from '../entities/cron-job-run.entity';
import { CronJobName } from '../enums/cron-job-name.enum';
import { NotificationService } from '../notification.service';
import { MessageTypes } from '../types/notification.type';

const DEFAULT_OPS_EMAIL = 'dayo.akinbami@agrofount.com';
const DEFAULT_OPS_PHONE = '2349019170273';

@Injectable()
export class CronMonitorService implements OnModuleInit {
  private readonly logger = new Logger(CronMonitorService.name);

  constructor(
    @InjectRepository(CronJobConfigEntity)
    private readonly configRepo: Repository<CronJobConfigEntity>,
    @InjectRepository(CronJobRunEntity)
    private readonly runRepo: Repository<CronJobRunEntity>,
    private readonly notificationService: NotificationService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const seeds = Object.values(CronJobName).map((name) =>
      this.configRepo.create({ jobName: name, enabled: false }),
    );
    await this.configRepo.upsert(seeds, {
      conflictPaths: ['jobName'],
      skipUpdateIfNoValuesChanged: true,
    });
  }

  async isEnabled(jobName: CronJobName): Promise<boolean> {
    try {
      const config = await this.configRepo.findOne({ where: { jobName } });
      return config?.enabled ?? false;
    } catch (err) {
      this.logger.warn(
        `isEnabled check failed for ${jobName}, defaulting to false: ${
          (err as Error).message
        }`,
      );
      return false;
    }
  }

  async startRun(jobName: CronJobName): Promise<CronJobRunEntity> {
    const run = this.runRepo.create({
      jobName,
      status: 'running',
      startedAt: new Date(),
    });
    return this.runRepo.save(run);
  }

  async finishRun(
    run: CronJobRunEntity,
    result: { sent: number; total: number; error?: string },
  ): Promise<void> {
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - run.startedAt.getTime();
    const succeeded = !result.error;
    const errorMessage = result.error ? result.error.slice(0, 1000) : null;

    await this.runRepo.update(run.id, {
      status: succeeded ? 'success' : 'failed',
      finishedAt,
      durationMs,
      sentCount: result.sent,
      totalCount: result.total,
      errorMessage,
    });

    await this.configRepo
      .createQueryBuilder()
      .update()
      .set({
        lastRunAt: finishedAt,
        lastRunStatus: succeeded ? 'success' : 'failed',
        lastRunDurationMs: durationMs,
        lastRunError: errorMessage,
        totalRuns: () => '"totalRuns" + 1',
        totalSuccesses: succeeded
          ? () => '"totalSuccesses" + 1'
          : () => '"totalSuccesses"',
        totalFailures: !succeeded
          ? () => '"totalFailures" + 1'
          : () => '"totalFailures"',
      })
      .where('"jobName" = :jobName', { jobName: run.jobName })
      .execute();

    if (result.sent > 0 || result.error) {
      await this.notifyOpsOfRunStats(run.jobName, result);
    }
  }

  private async notifyOpsOfRunStats(
    jobName: CronJobName,
    result: { sent: number; total: number; error?: string },
  ): Promise<void> {
    const opsEmail =
      this.configService.get<string>('CRON_SUMMARY_ADMIN_EMAIL') ||
      DEFAULT_OPS_EMAIL;
    const opsPhone =
      this.configService.get<string>('CRON_SUMMARY_ADMIN_PHONE') ||
      DEFAULT_OPS_PHONE;

    const status = result.error ? 'FAILED' : 'completed';
    const summaryLine = `${jobName} ${status} — ${result.sent}/${
      result.total
    } notifications sent${result.error ? ` (error: ${result.error})` : ''}.`;

    try {
      await this.notificationService.sendCustomEmail(
        { email: opsEmail },
        `Ayo Cron: ${jobName} ${status}`,
        `<p>${summaryLine}</p>`,
        summaryLine,
        MessageTypes.CRON_JOB_SUMMARY,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to email cron run summary for ${jobName}: ${
          (err as Error).message
        }`,
      );
    }

    try {
      await this.notificationService.sendNotification(
        'SMS',
        { phoneNumber: opsPhone },
        MessageTypes.CRON_JOB_SUMMARY,
        {
          jobName,
          sent: result.sent,
          total: result.total,
          error: result.error,
        },
      );
    } catch (err) {
      this.logger.warn(
        `Failed to SMS cron run summary for ${jobName}: ${
          (err as Error).message
        }`,
      );
    }
  }

  async listJobs(): Promise<CronJobConfigEntity[]> {
    return this.configRepo.find({ order: { jobName: 'ASC' } });
  }

  async getJobRuns(
    jobName: CronJobName,
    limit = 20,
  ): Promise<CronJobRunEntity[]> {
    return this.runRepo.find({
      where: { jobName },
      order: { startedAt: 'DESC' },
      take: Math.min(limit, 100),
    });
  }

  async setEnabled(
    jobName: CronJobName,
    enabled: boolean,
    adminId: string,
  ): Promise<CronJobConfigEntity> {
    const config = await this.configRepo.findOne({ where: { jobName } });
    if (!config)
      throw new NotFoundException(`Cron job config not found: ${jobName}`);
    config.enabled = enabled;
    config.updatedBy = adminId;
    return this.configRepo.save(config);
  }
}
