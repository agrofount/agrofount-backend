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
import { In, Repository } from 'typeorm';
import { ProductLocationEntity } from '../product-location/entities/product-location.entity';
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
    await this.mutate(userId, (cart) => {
      cart[dto.itemId] ||= {};
      cart[dto.itemId][dto.selectedUOMUnit] = { quantity: dto.quantity };
      this.assertCartSize(cart);
      return cart;
    });
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

    await this.redis.set(
      this.key(userId),
      JSON.stringify(next),
      'EX',
      this.ttlSeconds,
    );
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
    return { items: await this.getCartData(userId) };
  }

  async getCartData(userId: string): Promise<Record<string, any>> {
    const cart = await this.read(userId);
    if (this.lineCount(cart) === 0)
      throw new NotFoundException('Cart not found');
    return this.hydrate(cart);
  }

  async getAllCarts(cursor = '0', limit = 25) {
    const safeLimit = Math.min(100, Math.max(1, Math.trunc(limit)));
    const [nextCursor, keys] = await this.redis.scan(
      cursor,
      'MATCH',
      'cart:*',
      'COUNT',
      safeLimit,
    );
    const values = keys.length ? await this.redis.mget(keys) : [];
    return {
      items: keys.map((key, index) => ({
        userId: key.slice('cart:'.length),
        cart: this.parse(values[index]),
      })),
      nextCursor,
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

  async clear(userId: string) {
    const deleted = await this.redis.del(this.key(userId));
    if (!deleted) throw new BadRequestException('No cart found');
    return { success: true };
  }

  private async mutate(
    userId: string,
    update: (cart: StoredCart) => StoredCart,
  ): Promise<void> {
    const key = this.key(userId);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await this.redis.watch(key);
      const next = update(this.parse(await this.redis.get(key)));
      const result = await this.redis
        .multi()
        .set(key, JSON.stringify(next), 'EX', this.ttlSeconds)
        .exec();
      if (result !== null) return;
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
