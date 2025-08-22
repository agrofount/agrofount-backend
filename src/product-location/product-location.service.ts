import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CreateProductLocationDto,
  CreateProductLocationNotificationDto,
} from './dto/create-product-location.dto';
import { UpdateProductLocationDto } from './dto/update-product-location.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { ProductLocationEntity } from './entities/product-location.entity';
import { Not, Repository } from 'typeorm';
import { ProductService } from '../product/services/product.service';
import { CountryService } from '../country/country.service';
import { StateService } from '../state/state.service';
import { paginate, Paginated, PaginateQuery } from 'nestjs-paginate';
import { PRODUCT_LOCATION_PAGINATION_CONFIG } from './config/pagination.config';
import { ProductLocationNotificationEntity } from './entities/product-location-notification.entity';
import {
  MessageTypes,
  NotificationChannels,
} from '../notification/types/notification.type';
import { NotificationService } from '../notification/notification.service';
import { AddSEODto } from './dto/add-seo.dto';
import { SEOEntity } from './entities/product-location-seo';
import { Cron } from '@nestjs/schedule';
import { AnimalCategory } from 'src/product/types/product.enum';

@Injectable()
export class ProductLocationService {
  private readonly logger = new Logger(ProductLocationService.name);

  constructor(
    @InjectRepository(ProductLocationEntity)
    private readonly productLocationRepo: Repository<ProductLocationEntity>,
    @InjectRepository(SEOEntity)
    private readonly seoRepo: Repository<SEOEntity>,
    @InjectRepository(ProductLocationNotificationEntity)
    private readonly productLocationNotificationRepo: Repository<ProductLocationNotificationEntity>,
    private readonly productService: ProductService,
    private readonly countryService: CountryService,
    private readonly stateService: StateService,
    private readonly notificationService: NotificationService,
  ) {}

  async addSEO(slug: string, dto: AddSEODto) {
    const productLocation = await this.findOne(slug);

    if (productLocation.seo) {
      return this.updateSEO(productLocation, dto);
    }

    const { title, description, altText, imgUrl, metaTags, createdById } = dto;

    const SEOEntity = this.seoRepo.create({
      title,
      description,
      altText,
      imgUrl,
      metaTags,
      createdById,
    });

    const seo = await this.seoRepo.save(SEOEntity);

    productLocation.seo = seo;
    await this.productLocationRepo.save(productLocation);

    return seo;
  }

  async updateSEO(productLocation: ProductLocationEntity, dto: AddSEODto) {
    let seo = await this.seoRepo.findOneBy({
      id: productLocation.seo.id,
    });

    if (!seo) {
      throw new NotFoundException('SEO not found');
    }

    seo.title = dto.title || seo.title;
    seo.description = dto.description || seo.description;
    seo.altText = dto.altText || seo.altText;
    seo.imgUrl = dto.imgUrl || seo.imgUrl;
    seo.metaTags = dto.metaTags || seo.metaTags;

    return this.seoRepo.save(seo);
  }

  async create(dto: CreateProductLocationDto) {
    const { productId, stateId, countryId, price, uom, moq, createdById } = dto;

    const product = await this.productService.findOne(productId);
    const country = await this.countryService.findOne(countryId);
    const state = await this.stateService.findOne(stateId);

    const productLocation = this.productLocationRepo.create({
      price,
      uom,
      product,
      country,
      state,
      createdById,
    });

    return this.productLocationRepo.save(productLocation);
  }

  async findAll(
    query: PaginateQuery,
  ): Promise<Paginated<ProductLocationEntity>> {
    return paginate(query, this.productLocationRepo, {
      ...PRODUCT_LOCATION_PAGINATION_CONFIG,
    });
  }

  async findAllForAI(): Promise<ProductLocationEntity[]> {
    return this.productLocationRepo.find();
  }

  async findOne(slug: string) {
    try {
      const productLocation = await this.productLocationRepo.findOneBy({
        productSlug: slug,
      });

      if (!productLocation) {
        throw new NotFoundException(`Product location ${slug} not found`);
      }

      this.incrementViews(productLocation.id);

      return productLocation;
    } catch (error) {
      console.error('Error parsing custom filters:', error);
      throw new BadRequestException('Error getting product location');
    }
  }

  async findById(id: string) {
    try {
      const productLocation = await this.productLocationRepo.findOneBy({
        id,
      });

      if (!productLocation) {
        throw new NotFoundException(`Product location ${id} not found`);
      }

      return productLocation;
    } catch (error) {
      console.error('Error parsing custom filters:', error);
      throw new BadRequestException('Error getting product location');
    }
  }

  async checkExistByCategory(category: AnimalCategory) {
    const count = await this.productLocationRepo.count({
      where: {
        product: {
          category,
        },
      },
      relations: ['product'],
    });
    return count > 0;
  }

  async checkExistBySubCategory(subCategory: string) {
    const count = await this.productLocationRepo.count({
      where: {
        product: {
          subCategory,
        },
      },
      relations: ['product'],
    });
    return count > 0;
  }

  async update(slug: string, dto: UpdateProductLocationDto) {
    const { stateId } = dto;

    const productLocation = await this.findOne(slug);

    const state = await this.stateService.findOne(stateId);

    Object.assign(productLocation, { ...dto, state });

    return this.productLocationRepo.save(productLocation);
  }

  async remove(slug: string) {
    const productLocation = await this.findOne(slug);

    await this.productLocationRepo.softRemove(productLocation);
  }

  async createNotification(dto: CreateProductLocationNotificationDto) {
    const { email, slug, username } = dto;
    const productLocation = await this.findOne(slug);
    const notificationExist =
      await this.productLocationNotificationRepo.findOne({
        where: {
          email,
          productLocation: { productSlug: slug },
          notificationSent: false,
        },
      });

    if (notificationExist) {
      throw new ConflictException('Notification already created');
    }

    const notificationEntity =
      await this.productLocationNotificationRepo.create({
        email,
        username,
        productLocation,
      });

    const notification = await this.productLocationNotificationRepo.save(
      notificationEntity,
    );

    if (notification) {
      this.notificationService.sendNotification(
        NotificationChannels.EMAIL,
        { email },
        MessageTypes.PRODUCT_AVAILABLE_INTEREST_EMAIL,
        {
          customer_name: username,
          product_name: productLocation.product.name,
          product_slug: productLocation.productSlug,
        },
      );
    }

    return notification;
  }

  async publish(slug: string) {
    let productLocation = await this.findOne(slug);

    productLocation.isDraft = !productLocation.isDraft;

    productLocation = await this.productLocationRepo.save(productLocation);

    if (productLocation.isAvailable) {
      this.sendProductAvailabilityNotifications(productLocation.id);
    }

    return productLocation;
  }

  async handleOutOfStock(slug: string) {
    let productLocation = await this.findOne(slug);
    productLocation.isAvailable = !productLocation.isAvailable;
    return this.productLocationRepo.save(productLocation);
  }

  async sendProductAvailabilityNotifications(id: string) {
    const availabilityNotifications =
      await this.productLocationNotificationRepo.find({
        where: { productLocation: { id }, notificationSent: false },
        relations: ['productLocation', 'productLocation.product'],
      });

    for (const notification of availabilityNotifications) {
      const { email, username, productLocation } = notification;

      try {
        await this.notificationService.sendNotification(
          NotificationChannels.EMAIL,
          { email },
          MessageTypes.PRODUCT_AVAILABLE_EMAIL,
          {
            customer_name: username,
            product_name: productLocation.product.name,
            product_slug: productLocation.productSlug,
          },
        );

        // Mark notification as sent
        notification.notificationSent = true;
        await this.productLocationNotificationRepo.save(notification);
      } catch (error) {
        console.error(`Failed to send notification to ${email}`, error);
      }
    }
  }

  async incrementViews(productLocationId: string): Promise<void> {
    await this.productLocationRepo.increment(
      { id: productLocationId },
      'views',
      1,
    );
  }

  async incrementAddedToCart(productLocationId: string): Promise<void> {
    await this.productLocationRepo.increment(
      { id: productLocationId },
      'addToCartCount',
      1,
    );
  }

  @Cron('45 * * * * *') // every hour
  async updatePopularityScores() {
    const products = await this.productLocationRepo.find({
      relations: ['reviews'],
    });

    for (const product of products) {
      const positiveReviews = product.reviews.filter((r) => r.star >= 4).length;

      product.popularityScore = Math.round(
        (product.views || 0) * 1 +
          (product.addToCartCount || 0) * 2 +
          (product.purchaseCount || 0) * 5 +
          positiveReviews * 3,
      );

      await this.productLocationRepo.save(product);
    }
  }

  async getRecommendations(filters: {
    feedCategory: string;
    productCategories: string[];
    additives?: string[];
    animalType: string;
    lifecycleStage?: string;
    limit?: number;
  }) {
    const query = this.productLocationRepo
      .createQueryBuilder('productLocation')
      .leftJoinAndSelect('productLocation.product', 'product')
      .where('productLocation.isAvailable = :isAvailable', {
        isAvailable: true,
      });

    // Apply feed category filter
    if (filters.feedCategory) {
      query.andWhere('product.category = :feedCategory', {
        feedCategory: filters.feedCategory,
      });
    }

    // Order by popularity and price
    query
      .orderBy('productLocation.popularityScore', 'DESC')
      .addOrderBy('productLocation.price', 'ASC')
      .limit(filters.limit || 5);

    const products = await query.getMany();

    // Get best location for each product
    return Promise.all(
      products.map(async (product) => {
        const bestLocation = await this.productLocationRepo.findOne({
          where: { product: { id: product.id } },
          order: { price: 'ASC' },
        });

        return {
          ...product,
          bestLocation,
          dosage: this.getRecommendedDosage(product, filters.animalType),
        };
      }),
    );
  }

  private getRecommendedDosage(
    productLocation: ProductLocationEntity,
    animalType: string,
  ): string {
    // Your logic to determine dosage based on product and animal type
    return 'Follow manufacturer instructions';
  }

  private async getBestProductLocation(productId: string) {
    return this.productLocationRepo.findOne({
      where: { product: { id: productId } },
      order: {
        viewPriority: 'DESC',
        popularityScore: 'DESC',
        price: 'ASC', // Prefer lower prices
      },
      relations: ['state', 'country'],
    });
  }

  async getAlternativeProducts(productId: string, limit = 3) {
    // Get the original product to determine category and animal type
    const original = await this.productLocationRepo.findOne({
      where: { id: productId },
      relations: ['product'],
    });

    if (!original) return [];

    // Find similar products (same category and animal type)
    return this.productLocationRepo.find({
      where: {
        product: {
          category: original.product.category,
          subCategory: original.product.subCategory,
        },
        id: Not(original.id), // Exclude the original product
      },
      relations: ['product'],
      take: limit,
      order: {
        popularityScore: 'DESC',
      },
    });
  }

  async getAvailableRecommendations(
    category: string,
    animalType: string,
    limit = 5,
  ) {
    const query = this.productLocationRepo
      .createQueryBuilder('productLocation')
      .leftJoinAndSelect('productLocation.product', 'product')
      .where('product.category = :category', { category })
      .andWhere('product.subCategory = :animalType', { animalType })
      .andWhere('productLocation.isAvailable = :isAvailable', {
        isAvailable: true,
      })
      .orderBy('productLocation.popularityScore', 'DESC')
      .addOrderBy('productLocation.bestSeller', 'DESC')
      .addOrderBy('productLocation.price', 'ASC')
      .take(limit);

    return query.getMany();
  }

  async triggerPriceUpdateDigest(): Promise<string> {
    this.logger.log('Optimized price update digest started...');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Use QueryRunner for transaction
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Step 1: Fetch today’s price changes (latest per product)
      const rawChanges = await this.priceHistoryRepo.find({
        where: { changedAt: () => `changed_at >= '${today.toISOString()}'` },
        relations: ['product'],
        order: { changedAt: 'DESC' },
      });

      const latestChangesByProduct = new Map<number, PriceHistory>();
      for (const change of rawChanges) {
        if (!latestChangesByProduct.has(change.product.id)) {
          latestChangesByProduct.set(change.product.id, change);
        }
      }
      const latestChanges = Array.from(latestChangesByProduct.values());
      const productIds = latestChanges.map((c) => c.product.id);

      if (!productIds.length) {
        await queryRunner.rollbackTransaction();
        return 'No price changes today.';
      }

      // Step 2: Fetch all likes in one query
      const likes = await this.userLikeRepo.find({
        where: { product: { id: In(productIds) } },
        relations: ['user', 'product'],
      });

      // Step 3: Group notifications by user
      const userNotifications: Record<string, any[]> = {};
      for (const like of likes) {
        const change = latestChanges.find(
          (c) => c.product.id === like.product.id,
        );
        if (!change) continue;

        if (!userNotifications[like.user.id]) {
          userNotifications[like.user.id] = [];
        }

        userNotifications[like.user.id].push({
          productName: change.product.name,
          oldPrice: change.oldPrice,
          newPrice: change.newPrice,
          percentageChange: this.calculatePercentageChange(
            change.oldPrice,
            change.newPrice,
          ),
        });
      }

      // Step 4: Queue notifications instead of sending immediately
      for (const [userId, changes] of Object.entries(userNotifications)) {
        await this.notificationQueue.add('sendPriceUpdateDigest', {
          userId,
          changes,
        });
      }

      await queryRunner.commitTransaction();
      return 'Price update digests queued successfully.';
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error('Failed to build price update digest', error);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private calculatePercentageChange(
    oldPrice: number,
    newPrice: number,
  ): number {
    if (!oldPrice || oldPrice <= 0) return 0;
    return Number((((newPrice - oldPrice) / oldPrice) * 100).toFixed(2));
  }
}
