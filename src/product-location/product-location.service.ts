import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CreateProductLocationDto,
  CreateProductLocationNotificationDto,
} from './dto/create-product-location.dto';
import { UpdateProductLocationDto } from './dto/update-product-location.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { ProductLocationEntity } from './entities/product-location.entity';
import { Repository } from 'typeorm';
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

@Injectable()
export class ProductLocationService {
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
      moq,
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

      product.popularityScore =
        (product.views || 0) * 1 +
        (product.addToCartCount || 0) * 2 +
        (product.purchaseCount || 0) * 5 +
        positiveReviews * 3;

      await this.productLocationRepo.save(product);
    }
  }
}
