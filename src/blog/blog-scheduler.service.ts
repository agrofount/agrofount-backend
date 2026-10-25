import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuditLogService } from '../audit-log/audit-log.service';

type PublishedRow = {
  id: string;
  slug: string;
  publishedAt: Date;
  publishedById: string | null;
};

/**
 * Publishes scheduled blog posts once they are due. The whole job is one
 * UPDATE ... RETURNING, so overlapping runs or several instances can never
 * publish the same post twice: the second one finds no matching row.
 */
@Injectable()
export class BlogSchedulerService {
  private readonly logger = new Logger(BlogSchedulerService.name);
  private running = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.publishDuePosts();
    } catch (error) {
      this.logger.error(
        `Scheduled blog publishing failed: ${error?.message || error}`,
        error?.stack,
      );
    } finally {
      this.running = false;
    }
  }

  async publishDuePosts(now: Date = new Date()): Promise<number> {
    // `now` is passed as a parameter, not taken from the database clock, so
    // the comparison uses the same timestamp convention as the stored values.
    const [rows] = (await this.dataSource.query(
      `UPDATE "posts"
       SET "published" = true,
           "publishedAt" = "scheduledAt",
           "publishedById" = "scheduledById",
           "scheduledAt" = NULL,
           "scheduledById" = NULL,
           "updatedAt" = $1
       WHERE "published" = false
         AND "scheduledAt" IS NOT NULL
         AND "scheduledAt" <= $1
         AND "deletedAt" IS NULL
       RETURNING "id", "slug", "publishedAt", "publishedById"`,
      [now],
    )) as [PublishedRow[], number];

    for (const post of rows) {
      this.logger.log(`Published scheduled blog post ${post.slug}`);
      try {
        await this.auditLogService.record({
          action: 'PUBLISH_SCHEDULED_BLOG_POST',
          entityType: 'Post',
          entityId: post.id,
          userId: post.publishedById,
          actorType: 'system',
          outcome: 'succeeded',
          changes: {
            slug: post.slug,
            publishedAt: post.publishedAt,
            scheduledBy: post.publishedById,
          },
        });
      } catch (error) {
        this.logger.error(
          `Failed to audit scheduled publish of ${post.slug}: ${error?.message}`,
        );
      }
    }
    return rows.length;
  }
}
