import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CronJobConfigEntity } from '../entities/cron-job-config.entity';
import { CronJobRunEntity } from '../entities/cron-job-run.entity';
import { CronJobName } from '../enums/cron-job-name.enum';

@Injectable()
export class CronMonitorService implements OnModuleInit {
  private readonly logger = new Logger(CronMonitorService.name);

  constructor(
    @InjectRepository(CronJobConfigEntity)
    private readonly configRepo: Repository<CronJobConfigEntity>,
    @InjectRepository(CronJobRunEntity)
    private readonly runRepo: Repository<CronJobRunEntity>,
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
