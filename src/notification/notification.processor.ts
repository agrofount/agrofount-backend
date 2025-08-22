// price-updates.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { DataSource, In } from 'typeorm';
import { ProductLike } from '../product-location/entities/product-likes.entity';
import { PriceHistoryEntity } from '../product-location/entities/product-location-price-history';
import { NotificationService } from './notification.service';
import { MessageTypes, NotificationChannels } from './types/notification.type';
import { Logger } from '@nestjs/common';
import { UserNotificationData } from './interfaces/notifications.interface';
@Processor('price-updates')
export class PriceUpdatesProcessor extends WorkerHost {
  private readonly BATCH_SIZE = 100;
  private readonly logger = new Logger(PriceUpdatesProcessor.name);
  constructor(
    private dataSource: DataSource,
    private readonly notificationService: NotificationService,
  ) {
    super();
  }

  async process() {
    return this.dataSource.transaction(async (manager) => {
      // 1. Get most recent price changes for today
      const latestPriceChanges = await this.getLatestPriceChanges(manager);

      if (latestPriceChanges.length === 0) {
        this.logger.log('No price changes found for today');

        return; // No changes to process
      }

      // 2. Get product location IDs that have price changes
      const productLocationIds = latestPriceChanges.map(
        (change) => change.productLocation.id,
      );

      // 3. Get likes for products with price changes
      const likes = await manager.find(ProductLike, {
        where: { productLocation: { id: In(productLocationIds) } },
        relations: ['user', 'productLocation', 'productLocation.product'],
      });

      if (likes.length === 0) {
        this.logger.log('No users to notify for price updates');
        return; // No users to notify
      }

      // 4. Create user notification map
      const userMap = await this.createUserNotificationMap(
        likes,
        latestPriceChanges,
      );

      // 5. Send notifications in batches
      await this.sendNotificationsInBatches(userMap);
    });
  }

  private async getLatestPriceChanges(manager: any) {
    // Use subquery for better performance with DISTINCT ON
    const subQuery = manager
      .createQueryBuilder(PriceHistoryEntity, 'ph_sub')
      .select('ph_sub.productId, MAX(ph_sub.createdAt) as max_created_at')
      .groupBy('ph_sub.productId');

    return manager
      .createQueryBuilder(PriceHistoryEntity, 'ph')
      .innerJoin(
        `(${subQuery.getQuery()})`,
        'latest',
        'ph.productId = latest.productId AND ph.createdAt = latest.max_created_at',
      )
      .getMany();
  }

  private createUserNotificationMap(
    likes: ProductLike[],
    priceChanges: PriceHistoryEntity[],
  ) {
    const priceChangeMap = new Map(
      priceChanges.map((change) => [change.productLocation.id, change]),
    );

    const userMap = new Map<string, UserNotificationData>();

    for (const like of likes) {
      const change = priceChangeMap.get(like.productLocation.id);
      if (!change) continue;

      const percentageChange = this.calculatePercentageChange(
        change.oldPrice,
        change.newPrice,
      );

      if (!userMap.has(like.user.id)) {
        userMap.set(like.user.id, {
          name: like.user.username,
          email: like.user.email,
          phone: like.user.phone,
          updates: [],
        });
      }

      userMap.get(like.user.id)!.updates.push({
        product: like.productLocation.product.name,
        oldPrice: change.oldPrice,
        newPrice: change.newPrice,
        percentageChange: percentageChange.toFixed(2),
      });
    }

    return userMap;
  }

  private calculatePercentageChange(
    oldPrice: number,
    newPrice: number,
  ): number {
    return ((newPrice - oldPrice) / oldPrice) * 100;
  }

  private async sendNotificationsInBatches(
    userMap: Map<string, UserNotificationData>,
  ) {
    const users = Array.from(userMap.values());

    for (let i = 0; i < users.length; i += this.BATCH_SIZE) {
      const batch = users.slice(i, i + this.BATCH_SIZE);
      const notificationPromises = batch.map((user) =>
        this.sendUserNotification(user),
      );

      await Promise.allSettled(notificationPromises);
    }
  }

  private async sendUserNotification(user: UserNotificationData) {
    if (user.updates.length === 0) return;

    try {
      if (user.email) {
        await this.sendEmailNotification(user);
      } else if (user.phone) {
        await this.sendSmsNotification(user);
      }
    } catch (error) {
      console.error(`Failed to send notification to user ${user.name}:`, error);
      // Consider adding retry logic or dead letter queue here
    }
  }

  private async sendEmailNotification(user: UserNotificationData) {
    await this.notificationService.sendNotification(
      NotificationChannels.EMAIL,
      { email: user.email },
      MessageTypes.PRICE_UPDATE_NOTIFICATION,
      {
        firstName: user.name,
        updates: user.updates.map((u) => ({
          product: u.product,
          oldPrice: `₦${u.oldPrice}`,
          newPrice: `₦${u.newPrice}`,
          percent: this.formatPercentageChange(parseFloat(u.percentageChange)),
        })),
      },
    );
  }

  private async sendSmsNotification(user: UserNotificationData) {
    await this.notificationService.sendNotification(
      NotificationChannels.SMS,
      { phoneNumber: user.phone },
      MessageTypes.PRICE_UPDATE_NOTIFICATION,
      {
        message: this.createSmsMessage(user),
      },
    );
  }

  private createSmsMessage(user: UserNotificationData): string {
    const updatesText = user.updates
      .map(
        (u) =>
          `${u.product}: ₦${u.oldPrice} → ₦${
            u.newPrice
          } (${this.formatPercentageChange(parseFloat(u.percentageChange))})`,
      )
      .join(', ');

    return `Hello ${user.name}, here are your product price updates: ${updatesText}`;
  }

  private formatPercentageChange(percentage: number): string {
    return percentage > 0
      ? `+${percentage.toFixed(2)}%`
      : `${percentage.toFixed(2)}%`;
  }
}
