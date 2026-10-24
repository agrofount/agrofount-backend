import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { Brackets, In, Repository } from 'typeorm';
import { ProductLocationEntity } from '../product-location/entities/product-location.entity';
import { UserEntity } from '../user/entities/user.entity';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CartStartedNotifier } from './cart-started-notifier.service';
import { InventoryEntity } from '../inventory/entities/inventory.entity';
import {
  AdminAddCartLineDto,
  AdminUpdateCartLineDto,
} from './dto/admin-update-cart-line.dto';
import { AddToCartDto, CartItemDto } from './dto/create-cart.dto';
import { UpdateCartDto } from './dto/update-cart.dto';

type StoredCart = Record<string, Record<string, { quantity: number }>>;

@Injectable()
export class CartService implements OnModuleDestroy {
  private readonly logger = new Logger(CartService.name);
  private readonly redis: Redis;
  private readonly ttlSeconds = 24 * 60 * 60;
  private readonly maxCartLines = 100;

  constructor(
    configService: ConfigService,
    @InjectRepository(ProductLocationEntity)
    private readonly productLocationRepository: Repository<ProductLocationEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(InventoryEntity)
    private readonly inventoryRepository: Repository<InventoryEntity>,
    private readonly auditLogService: AuditLogService,
    private readonly cartStartedNotifier: CartStartedNotifier,
  ) {
    this.redis = new Redis(configService.getOrThrow<string>('REDIS_URL'), {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }

  async addToCart(userId: string, dto: AddToCartDto) {
    await this.assertProductUnit(dto.itemId, dto.selectedUOMUnit);
    const { wasEmpty } = await this.mutate(userId, (cart) => {
      cart[dto.itemId] ||= {};
      cart[dto.itemId][dto.selectedUOMUnit] = { quantity: dto.quantity };
      this.assertCartSize(cart);
      return cart;
    });
    if (wasEmpty)
      this.cartStartedNotifier.notifyCartStarted(userId, dto.itemId);
    await this.incrementAddedToCart(dto.itemId);
    return this.getCartData(userId);
  }

  async syncCart(userId: string, items: CartItemDto[]) {
    const uniqueLines = new Set(
      items.map((item) => `${item.itemId}:${item.selectedUOMUnit}`),
    );
    if (uniqueLines.size !== items.length) {
      throw new BadRequestException(
        'Cart contains duplicate item and unit pairs',
      );
    }
    if (items.length > this.maxCartLines) {
      throw new BadRequestException(
        `Cart cannot contain more than ${this.maxCartLines} lines`,
      );
    }

    const products = await this.loadProducts(items.map((item) => item.itemId));
    const next: StoredCart = {};
    for (const item of items) {
      this.assertUnit(products.get(item.itemId) || null, item.selectedUOMUnit);
      next[item.itemId] ||= {};
      next[item.itemId][item.selectedUOMUnit] = { quantity: item.quantity };
    }

    // GET and SET in one MULTI, so "was the cart empty" is atomic with the write.
    const [[, previous]] = (await this.redis
      .multi()
      .get(this.key(userId))
      .set(this.key(userId), JSON.stringify(next), 'EX', this.ttlSeconds)
      .exec()) as [[Error | null, string | null], unknown];
    if (this.lineCount(this.parse(previous)) === 0 && items.length > 0) {
      this.cartStartedNotifier.notifyCartStarted(userId, items[0].itemId);
    }
    await Promise.all(
      [...new Set(items.map((item) => item.itemId))].map((id) =>
        this.incrementAddedToCart(id),
      ),
    );

    return {
      success: true,
      message: 'Cart synced successfully',
      data: await this.hydrate(next),
    };
  }

  async getCart(userId: string) {
    const cart = await this.read(userId);
    return {
      items: this.lineCount(cart) > 0 ? await this.hydrate(cart) : {},
    };
  }

  async getCartData(userId: string): Promise<Record<string, any>> {
    const cart = await this.read(userId);
    if (this.lineCount(cart) === 0)
      throw new NotFoundException('Cart not found');
    return this.hydrate(cart);
  }

  async getAllCarts(cursor = '0', limit = 25) {
    const safeLimit = Math.min(500, Math.max(1, Math.trunc(limit)));
    // SCAN filters after sampling, so a page can be empty while more matches
    // remain. Keep scanning until the page is full or the keyspace is done.
    const found = new Set<string>();
    let nextCursor = cursor;
    let scans = 0;
    do {
      const [next, batch] = await this.redis.scan(
        nextCursor,
        'MATCH',
        'cart:*',
        'COUNT',
        500,
      );
      nextCursor = next;
      batch.forEach((key) => found.add(key));
      scans += 1;
    } while (nextCursor !== '0' && found.size < safeLimit && scans < 50);
    const keys = [...found];
    const values = keys.length ? await this.redis.mget(keys) : [];
    const carts = keys.map((key, index) => ({
      userId: key.slice('cart:'.length),
      data: this.parse(values[index]),
    }));
    const userIds = carts.map(({ userId }) => userId);
    const users = userIds.length
      ? await this.userRepository.find({ where: { id: In(userIds) } })
      : [];
    const usersById = new Map(users.map((user) => [user.id, user]));

    return {
      items: await Promise.all(
        carts.map(async ({ userId, data }) => {
          const ttl = await this.redis.ttl(this.key(userId));
          const itemCount = this.lineCount(data);
          return {
            userId,
            user: this.toAdminUserSummary(usersById.get(userId)),
            active: itemCount > 0,
            itemCount,
            expiresInSeconds: ttl >= 0 ? ttl : null,
          };
        }),
      ),
      nextCursor: nextCursor === '0' ? null : nextCursor,
    };
  }

  async getCartForAdmin(userId: string) {
    const raw = await this.redis.get(this.key(userId));
    if (raw === null) throw new NotFoundException('Cart not found');

    const cart = this.parse(raw);
    const user = await this.userRepository.findOne({ where: { id: userId } });
    return {
      userId,
      user: this.toAdminUserSummary(user),
      active: this.lineCount(cart) > 0,
      itemCount: this.lineCount(cart),
      expiresInSeconds: Math.max(0, await this.redis.ttl(this.key(userId))),
      items: await this.hydrate(cart),
    };
  }

  async update(userId: string, dto: UpdateCartDto) {
    if (dto.quantity > 0) {
      await this.assertProductUnit(dto.itemId, dto.selectedUOMUnit);
    }
    await this.mutate(userId, (cart) => {
      if (dto.quantity === 0) {
        delete cart[dto.itemId]?.[dto.selectedUOMUnit];
        if (cart[dto.itemId] && Object.keys(cart[dto.itemId]).length === 0) {
          delete cart[dto.itemId];
        }
        return cart;
      }
      cart[dto.itemId] ||= {};
      cart[dto.itemId][dto.selectedUOMUnit] = { quantity: dto.quantity };
      this.assertCartSize(cart);
      return cart;
    });
    return this.lineCount(await this.read(userId))
      ? this.getCartData(userId)
      : {};
  }

  async searchSellableProducts(search?: string, limit = 20) {
    const take = Math.min(50, Math.max(1, Math.trunc(limit) || 20));
    const query = this.productLocationRepository
      .createQueryBuilder('pl')
      .leftJoinAndSelect('pl.product', 'product')
      .leftJoinAndSelect('pl.state', 'state')
      .leftJoinAndSelect('pl.country', 'country')
      .where('pl.isDraft = false')
      .andWhere('pl.isAvailable = true');
    const term = search?.trim().replace(/[\\%_]/g, '\\$&');
    if (term) {
      query.andWhere(
        new Brackets((qb) =>
          qb
            .where('product.name ILIKE :term', { term: `%${term}%` })
            .orWhere('product.brand ILIKE :term', { term: `%${term}%` }),
        ),
      );
    }
    const locations = await query
      .orderBy('product.name', 'ASC')
      .take(take)
      .getMany();

    const inventory = locations.length
      ? await this.inventoryRepository.find({
          where: { productLocationId: In(locations.map((l) => l.id)) },
        })
      : [];
    const available = new Map(
      inventory.map((row) => [
        `${row.productLocationId}:${row.unit}`,
        Number(row.availableQuantity) - Number(row.reservedQuantity),
      ]),
    );

    return locations.map((location) => ({
      productLocationId: location.id,
      productId: location.product?.id ?? null,
      name: location.product?.name ?? null,
      slug: location.productSlug,
      brand: location.product?.brand ?? null,
      category: location.product?.category ?? null,
      image: location.product?.images?.[0] ?? null,
      images: location.product?.images ?? [],
      state: location.state
        ? { id: location.state.id, name: location.state.name }
        : null,
      country: location.country
        ? { id: location.country.id, name: location.country.name }
        : null,
      uom: (location.uom || []).map((uom) => ({
        unit: uom.unit,
        platformPrice: Number(uom.platformPrice),
        moq: uom.moq ?? null,
        stockQuantity: uom.stockQuantity ?? null,
        availableQuantity: available.get(`${location.id}:${uom.unit}`) ?? null,
      })),
    }));
  }

  async addLineForAdmin(
    admin: { id: string; email?: string },
    userId: string,
    dto: AdminAddCartLineDto,
  ) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const product = await this.productLocationRepository.findOne({
      where: { id: dto.productLocationId },
    });
    this.assertUnit(product, dto.unit);
    if (product.isDraft || !product.isAvailable) {
      throw new BadRequestException('Product is not available');
    }

    const existing =
      (await this.read(userId))[dto.productLocationId]?.[dto.unit]?.quantity ??
      0;
    const total = Number(existing) + dto.quantity;
    if (total > 1_000_000) {
      throw new BadRequestException('Quantity cannot exceed 1,000,000');
    }
    const inventory = await this.inventoryRepository.findOne({
      where: { productLocationId: dto.productLocationId, unit: dto.unit },
    });
    if (!inventory) {
      throw new BadRequestException(`Stock is not configured for ${dto.unit}`);
    }
    const available =
      Number(inventory.availableQuantity) - Number(inventory.reservedQuantity);
    if (total > available) {
      throw new BadRequestException(
        `Insufficient stock for ${dto.unit}. Available: ${Math.max(
          0,
          available,
        )}`,
      );
    }

    await this.mutate(userId, (cart) => {
      cart[dto.productLocationId] ||= {};
      cart[dto.productLocationId][dto.unit] = { quantity: total };
      this.assertCartSize(cart);
      return cart;
    });
    await this.auditAdminCartAction(admin, 'ADMIN_ADD_CART_LINE', userId, {
      productLocationId: dto.productLocationId,
      unit: dto.unit,
      added: dto.quantity,
      previousQuantity: Number(existing),
      quantity: total,
    });
    return this.getCartForAdmin(userId);
  }

  async updateLineForAdmin(
    admin: { id: string; email?: string },
    userId: string,
    dto: AdminUpdateCartLineDto,
  ) {
    const cart = await this.read(userId);
    if (this.lineCount(cart) === 0)
      throw new NotFoundException('Cart not found');
    const previous = cart[dto.productLocationId]?.[dto.unit];
    if (!previous) throw new NotFoundException('Cart line not found');

    await this.update(userId, {
      itemId: dto.productLocationId,
      selectedUOMUnit: dto.unit,
      quantity: dto.quantity,
    });
    await this.auditAdminCartAction(
      admin,
      dto.quantity === 0 ? 'ADMIN_REMOVE_CART_LINE' : 'ADMIN_UPDATE_CART_LINE',
      userId,
      {
        productLocationId: dto.productLocationId,
        unit: dto.unit,
        previousQuantity: previous.quantity,
        quantity: dto.quantity,
      },
    );
    return this.getCartForAdmin(userId);
  }

  async clearForAdmin(admin: { id: string; email?: string }, userId: string) {
    const raw = await this.redis.get(this.key(userId));
    if (raw === null) throw new NotFoundException('Cart not found');
    const cart = this.parse(raw);
    await this.redis.del(this.key(userId));
    await this.auditAdminCartAction(admin, 'ADMIN_CLEAR_CART', userId, {
      itemCount: this.lineCount(cart),
    });
  }

  private async auditAdminCartAction(
    admin: { id: string; email?: string },
    action: string,
    targetUserId: string,
    changes: Record<string, unknown>,
  ): Promise<void> {
    this.logger.log(
      `${action} by admin ${admin.id} on cart of user ${targetUserId}`,
    );
    try {
      await this.auditLogService.record({
        action,
        entityType: 'Cart',
        entityId: targetUserId,
        userId: admin.id,
        userEmail: admin.email || null,
        actorType: 'admin',
        outcome: 'succeeded',
        changes: { targetUserId, ...changes },
      });
    } catch (error) {
      this.logger.error('Failed to persist cart audit record', error?.stack);
    }
  }

  async clear(userId: string) {
    const deleted = await this.redis.del(this.key(userId));
    if (!deleted) throw new BadRequestException('No cart found');
    return { success: true };
  }

  private async mutate(
    userId: string,
    update: (cart: StoredCart) => StoredCart,
  ): Promise<{ wasEmpty: boolean }> {
    const key = this.key(userId);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await this.redis.watch(key);
      // Same read the write is guarded by, so "was empty" cannot race.
      const before = this.parse(await this.redis.get(key));
      // Counted before `update`, which edits the cart in place.
      const wasEmpty = this.lineCount(before) === 0;
      const next = update(before);
      const result = await this.redis
        .multi()
        .set(key, JSON.stringify(next), 'EX', this.ttlSeconds)
        .exec();
      if (result !== null) return { wasEmpty };
    }
    throw new InternalServerErrorException(
      'Cart was updated concurrently; please retry',
    );
  }

  private async read(userId: string): Promise<StoredCart> {
    return this.parse(await this.redis.get(this.key(userId)));
  }

  private parse(value: string | null): StoredCart {
    if (!value) return {};
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      this.logger.error('Discarding malformed cart cache entry', error?.stack);
      return {};
    }
  }

  private async hydrate(cart: StoredCart): Promise<Record<string, any>> {
    const products = await this.loadProducts(Object.keys(cart));
    const hydrated: Record<string, any> = {};
    for (const [itemId, units] of Object.entries(cart)) {
      const productLocation = products.get(itemId);
      if (
        !productLocation ||
        productLocation.isDraft ||
        !productLocation.isAvailable
      ) {
        continue;
      }
      for (const [unit, stored] of Object.entries(units)) {
        const uom = this.assertUnit(productLocation, unit);
        const quantity = Number(stored.quantity);
        const matchedVtp = uom.vtp?.find(
          (tier) => quantity >= tier.minVolume && quantity <= tier.maxVolume,
        );
        const platformPrice = Number(uom.platformPrice);
        const actualUnitPrice = Number(matchedVtp?.price ?? platformPrice);
        hydrated[itemId] ||= {};
        hydrated[itemId][unit] = {
          quantity,
          total: quantity * actualUnitPrice,
          platformPrice,
          actualUnitPrice,
          productLocation,
          priceDetails: {
            isVolumeDiscount: Boolean(matchedVtp),
            originalUnitPrice: platformPrice,
            discountPercentage: matchedVtp?.discount || 0,
            matchedVtp: matchedVtp || null,
            savings: matchedVtp
              ? (platformPrice - actualUnitPrice) * quantity
              : 0,
          },
        };
      }
    }
    return hydrated;
  }

  private async loadProducts(ids: string[]) {
    const uniqueIds = [...new Set(ids)];
    if (!uniqueIds.length) return new Map<string, ProductLocationEntity>();
    const products = await this.productLocationRepository.find({
      where: { id: In(uniqueIds) },
      relations: ['product', 'state', 'country'],
    });
    return new Map(products.map((product) => [product.id, product]));
  }

  private async assertProductUnit(itemId: string, unit: string): Promise<void> {
    const product = await this.productLocationRepository.findOne({
      where: { id: itemId },
    });
    this.assertUnit(product, unit);
    if (product.isDraft || !product.isAvailable) {
      throw new BadRequestException('Product is not available');
    }
  }

  private assertUnit(product: ProductLocationEntity | null, unit: string) {
    if (!product) throw new NotFoundException('Product location not found');
    const uom = product.uom.find((candidate) => candidate.unit === unit);
    if (!uom) throw new BadRequestException('Unit of Measure not found');
    return uom;
  }

  private assertCartSize(cart: StoredCart): void {
    if (this.lineCount(cart) > this.maxCartLines) {
      throw new BadRequestException(
        `Cart cannot contain more than ${this.maxCartLines} lines`,
      );
    }
  }

  private lineCount(cart: StoredCart): number {
    return Object.values(cart).reduce(
      (total, units) => total + Object.keys(units).length,
      0,
    );
  }

  private toAdminUserSummary(user?: UserEntity | null) {
    if (!user) return null;
    return {
      id: user.id,
      firstname: user.firstname,
      lastname: user.lastname,
      username: user.username,
      email: user.email,
      phone: user.phone,
    };
  }

  private async incrementAddedToCart(itemId: string): Promise<void> {
    await this.productLocationRepository.increment(
      { id: itemId },
      'addToCartCount',
      1,
    );
  }

  private key(userId: string): string {
    return `cart:${userId}`;
  }
}
