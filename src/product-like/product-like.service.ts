import {
  Injectable,
  NotFoundException,
  ConflictException,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { UserEntity } from '../user/entities/user.entity';
import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { ProductLike } from './entities/product-like.entity';
import { ProductLocationEntity } from 'src/product-location/entities/product-location.entity';

@Injectable()
export class ProductLikeService {
  constructor(
    @InjectRepository(ProductLike)
    private readonly likeRepo: Repository<ProductLike>,
    @InjectRepository(ProductLocationEntity)
    private readonly productRepo: Repository<ProductLocationEntity>,
    private readonly dataSource: DataSource,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async like(productLocationId: string, userId: string) {
    return this.dataSource.transaction(async (manager) => {
      const productLocation = await manager.findOne(ProductLocationEntity, {
        where: { id: productLocationId },
      });
      if (!productLocation) throw new NotFoundException('Product not found');

      // Idempotent: if already liked, just return current state
      const existing = await manager.findOne(ProductLike, {
        where: {
          productLocation: { id: productLocationId },
          user: { id: userId },
        },
        relations: ['productLocation', 'user'],
      });
      if (existing)
        return { liked: true, likesCount: productLocation.likesCount };

      // Insert like
      const like = manager.create(ProductLike, {
        productLocation: { id: productLocationId } as ProductLocationEntity,
        user: { id: userId } as UserEntity,
      });
      await manager.save(like);

      // Increment counter atomically
      await manager.increment(
        ProductLocationEntity,
        { id: productLocationId },
        'likesCount',
        1,
      );

      const updated = await manager.findOneByOrFail(ProductLocationEntity, {
        id: productLocationId,
      });

      return { liked: true, likesCount: updated.likesCount };
    });
  }

  async unlike(productLocationId: string, userId: string) {
    return this.dataSource.transaction(async (manager) => {
      const product = await manager.findOne(ProductLocationEntity, {
        where: { id: productLocationId },
      });
      if (!product) throw new NotFoundException('Product not found');

      const existing = await manager.findOne(ProductLike, {
        where: {
          productLocation: { id: productLocationId },
          user: { id: userId },
        },
        relations: ['productLocation', 'user'],
      });
      if (!existing) {
        // idempotent: nothing to delete
        return { liked: false, likesCount: product.likesCount };
      }

      await manager.remove(existing);
      await manager.decrement(
        ProductLocationEntity,
        { id: productLocationId },
        'likesCount',
        1,
      );

      const updated = await manager.findOneByOrFail(ProductLocationEntity, {
        id: productLocationId,
      });

      return { liked: false, likesCount: updated.likesCount };
    });
  }

  async isLiked(productId: string, userId: string): Promise<boolean> {
    const count = await this.likeRepo.count({
      where: { productLocation: { id: productId }, user: { id: userId } },
    });
    return count > 0;
  }

  async listMyLikes(userId: string, page = 1, limit = 20) {
    const [items, total] = await this.likeRepo.findAndCount({
      where: { user: { id: userId } },
      relations: ['productLocation'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items: items.map((i) => i.productLocation), total, page, limit };
  }

  /**
   * Trending products by likes within a rolling time window (e.g., 7 days).
   */
  async trending(days = 7, limit = 20) {
    const qb = this.likeRepo
      .createQueryBuilder('pl')
      .select('pl.productLocationId', 'productLocationId')
      .addSelect('COUNT(pl.id)', 'likes')
      .where('pl.createdAt >= NOW() - INTERVAL :days', { days: `${days} days` })
      .groupBy('pl.productLocationId')
      .orderBy('likes', 'DESC')
      .limit(limit);

    const rows = await qb.getRawMany<{
      productLocationId: string;
      likes: string;
    }>();
    const ids = rows.map((r) => r.productLocationId);
    if (ids.length === 0) return [];

    const products = await this.productRepo.findByIds(ids);
    // Preserve order by likes count
    const map = new Map(products.map((p) => [p.id, p]));
    return rows.map((r) => ({
      product: map.get(r.productLocationId),
      likes: Number(r.likes),
    }));
  }

  //   private async handleTrending(productLocationId: string, count = 1) {
  //     const cacheKey = `product:${productLocationId}:likes`;
  //     let cachedData = await this.cacheManager.get<string>(cacheKey);

  //     if (!cachedData) {
  //       // no cache yet → initialize
  //       const initialData = { likes: 0 };
  //       await this.cacheManager.set(cacheKey, JSON.stringify(initialData));
  //       cachedData = JSON.stringify(initialData);
  //     }

  //     const data = JSON.parse(cachedData);
  //     // now you can safely modify e.g.
  //     data.likes += count;

  //     // save updated
  //     await this.cacheManager.set(cacheKey, JSON.stringify(data));
  //   }
}
