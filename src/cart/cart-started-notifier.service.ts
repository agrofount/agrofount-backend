import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { Repository } from 'typeorm';
import { AdminEntity } from '../admins/entities/admin.entity';
import { NotificationGateway } from '../notification/gateways/notification.gateway';
import { NotificationService } from '../notification/notification.service';
import {
  MessageTypes,
  NotificationChannels,
} from '../notification/types/notification.type';
import { ProductLocationEntity } from '../product-location/entities/product-location.entity';
import { UserEntity } from '../user/entities/user.entity';

const COOLDOWN_SECONDS = 60 * 60;

/**
 * Tells admins when a customer starts a new cart: a Teams card plus an
 * in-app message for each admin who can manage carts. Carries no email or
 * phone, only the display name, first product and time. Never throws.
 */
@Injectable()
export class CartStartedNotifier implements OnModuleDestroy {
  private readonly logger = new Logger(CartStartedNotifier.name);
  private readonly redis: Redis;

  constructor(
    configService: ConfigService,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(AdminEntity)
    private readonly adminRepository: Repository<AdminEntity>,
    @InjectRepository(ProductLocationEntity)
    private readonly productLocationRepository: Repository<ProductLocationEntity>,
    private readonly notificationService: NotificationService,
    private readonly notificationGateway: NotificationGateway,
  ) {
    this.redis = new Redis(configService.getOrThrow<string>('REDIS_URL'), {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
    this.redis.on('error', (error) =>
      this.logger.warn(`Redis error: ${error.message}`),
    );
  }

  async onModuleDestroy() {
    if (this.redis.status === 'wait' || this.redis.status === 'end') return;
    await this.redis.quit().catch(() => this.redis.disconnect());
  }

  /** Fire and forget: the caller is never delayed or failed by this. */
  notifyCartStarted(userId: string, firstProductLocationId?: string): void {
    void this.run(userId, firstProductLocationId).catch((error) =>
      this.logger.error(
        `Cart-started notification failed: ${error?.message || error}`,
        error?.stack,
      ),
    );
  }

  private async run(userId: string, productLocationId?: string) {
    if (!(await this.claimCooldown(userId))) return;

    const [user, productName] = await Promise.all([
      this.userRepository.findOne({ where: { id: userId } }),
      this.firstProductName(productLocationId),
    ]);
    const customerName = this.displayName(user);
    const startedAt = new Date();
    const text = `${customerName} started a cart with ${productName}`;

    const results = await Promise.allSettled([
      this.sendTeams(customerName, productName, startedAt),
      this.notifyAdmins(text, customerName, productName, startedAt),
    ]);
    results.forEach((result) => {
      if (result.status === 'rejected') {
        this.logger.error(
          `Cart-started notification step failed: ${
            result.reason?.message || result.reason
          }`,
        );
      }
    });
  }

  /** At most one notification per user per hour. SET NX keeps it race-free. */
  private async claimCooldown(userId: string): Promise<boolean> {
    try {
      if (this.redis.status === 'wait') await this.redis.connect();
      const claimed = await this.redis.set(
        `cart-started:cooldown:${userId}`,
        '1',
        'EX',
        COOLDOWN_SECONDS,
        'NX',
      );
      return claimed === 'OK';
    } catch (error) {
      this.logger.warn(
        `Cart-started cooldown unavailable, skipping: ${error?.message}`,
      );
      return false;
    }
  }

  private displayName(user: UserEntity | null): string {
    const username = user?.username?.trim();
    if (username) return username;
    const fullName = [user?.firstname, user?.lastname]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(' ');
    return fullName || 'A customer';
  }

  private async firstProductName(id?: string): Promise<string> {
    if (!id) return 'an item';
    const location = await this.productLocationRepository.findOne({
      where: { id },
      relations: ['product'],
    });
    return location?.product?.name || 'an item';
  }

  private async sendTeams(
    customerName: string,
    productName: string,
    startedAt: Date,
  ) {
    // No recipient: this is an internal alert, so a customer's own
    // notification opt-outs must not suppress it.
    const result = await this.notificationService.sendNotification(
      NotificationChannels.TEAMS_NOTIFICATION,
      {},
      MessageTypes.CART_STARTED_NOTIFICATION,
      { customerName, productName, startedAt: startedAt.toISOString() },
    );
    if (result?.success === false) {
      throw new Error(result.message || 'Teams notification failed');
    }
  }

  private async notifyAdmins(
    text: string,
    customerName: string,
    productName: string,
    startedAt: Date,
  ) {
    const admins = (
      await this.adminRepository.find({
        where: { isVerified: true },
        relations: ['roles'],
      })
    ).filter((admin) => this.canManageCarts(admin));

    await Promise.all(
      admins.map(async (admin) => {
        await this.notificationService.recordDelivery({
          messageType: MessageTypes.CART_STARTED_NOTIFICATION,
          userId: admin.id,
          sender: 'Agrofount',
          message: text,
          channel: 'IN_APP',
          status: 'SENT',
        });
        try {
          await this.notificationGateway.emitToUser(admin.id, 'notification', {
            title: 'New cart started',
            message: text,
            customerName,
            productName,
            startedAt: startedAt.toISOString(),
          });
        } catch (error) {
          this.logger.warn(
            `Realtime cart-started push failed: ${error?.message}`,
          );
        }
      }),
    );
  }

  /** Mirrors RolesGuard for the manage_carts permission. */
  private canManageCarts(admin: AdminEntity): boolean {
    return (admin.roles || []).some(
      (role) =>
        role.name === 'superadmin' ||
        (role.permissions || []).some(
          (permission) =>
            permission.resource === 'carts' &&
            permission.actions?.includes('manage'),
        ),
    );
  }
}
