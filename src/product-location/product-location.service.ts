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

  // In ProductLocationService
  async findProductsByDiagnosis(criteria: {
    diagnosis: string;
    animalType: string;
    subCategory: string;
    symptoms: string[];
    searchQuery: string;
  }): Promise<any[]> {
    // Implementation to query your database based on diagnosis
    // This should search product names, descriptions, categories, tags
    // that match the diagnosis and symptoms
    const mainTerms = this.extractMainTerms(criteria.diagnosis);

    if (!mainTerms || mainTerms.trim() === '') {
      return [];
    }

    // Convert animalType to match your AnimalCategory enum
    const animalCategory = this.mapToAnimalCategory(criteria.animalType);

    // Split main terms for individual searching
    const searchTerms = mainTerms.split(' ');

    // Build query on ProductLocationEntity with product relations
    const queryBuilder = this.productLocationRepo
      .createQueryBuilder('productLocation')
      .leftJoinAndSelect('productLocation.product', 'product')
      .leftJoinAndSelect('productLocation.state', 'state')
      .leftJoinAndSelect('productLocation.country', 'country')
      .where('product.category = :animalCategory', { animalCategory })
      .andWhere('productLocation.isAvailable = :isAvailable', {
        isAvailable: true,
      })
      .andWhere('productLocation.isDraft = :isDraft', { isDraft: false });

    // Add search conditions for each term on the product fields
    const orConditions = searchTerms.map(
      (term) =>
        `(product.name ILIKE :term OR 
        product.description ILIKE :term OR 
        product.subCategory ILIKE :term OR
        product.brand ILIKE :term)`,
    );

    if (orConditions.length > 0) {
      queryBuilder.andWhere(`(${orConditions.join(' OR ')})`);

      // Add parameters for each term
      searchTerms.forEach((term) => {
        queryBuilder.setParameter('term', `%${term}%`);
      });
    }

    return await queryBuilder
      .orderBy('productLocation.popularityScore', 'DESC')
      .addOrderBy('productLocation.viewPriority', 'DESC')
      .addOrderBy('productLocation.bestSeller', 'DESC')
      .limit(8)
      .getMany();
  }

  async findProductsBySymptoms(
    symptoms: string[],
    animalType: string,
  ): Promise<any[]> {
    try {
      if (!symptoms || symptoms.length === 0) {
        return [];
      }

      // Convert animalType to match your AnimalCategory enum
      const animalCategory = this.mapToAnimalCategory(animalType);

      const queryBuilder = this.productLocationRepo
        .createQueryBuilder('productLocation')
        .leftJoinAndSelect('productLocation.product', 'product')
        .leftJoinAndSelect('productLocation.state', 'state')
        .leftJoinAndSelect('productLocation.country', 'country')
        .where('product.category = :animalCategory', { animalCategory })
        .andWhere('productLocation.isAvailable = :isAvailable', {
          isAvailable: true,
        })
        .andWhere('productLocation.isDraft = :isDraft', { isDraft: false });

      // Build OR conditions for each symptom on product fields
      const orConditions = symptoms.map(
        (symptom) =>
          `(product.name ILIKE :symptom OR 
        product.description ILIKE :symptom OR 
        product.subCategory ILIKE :symptom OR
        product.brand ILIKE :symptom)`,
      );

      if (orConditions.length > 0) {
        queryBuilder.andWhere(`(${orConditions.join(' OR ')})`);

        // Add parameters for each symptom
        symptoms.forEach((symptom) => {
          queryBuilder.setParameter('symptom', `%${symptom}%`);
        });
      }

      return await queryBuilder
        .orderBy('productLocation.popularityScore', 'DESC')
        .addOrderBy('productLocation.viewPriority', 'DESC')
        .addOrderBy('productLocation.bestSeller', 'DESC')
        .limit(6)
        .getMany();
    } catch (error) {
      this.logger.error('Error finding products by symptoms:', error);
      return [];
    }
  }

  private extractMainTerms(diagnosis: string): string {
    if (!diagnosis) return '';

    // Convert to lowercase for consistent matching
    const lowerDiagnosis = diagnosis.toLowerCase();

    // Remove common stop words and focus on key terms
    const stopWords = new Set([
      'the',
      'a',
      'an',
      'and',
      'or',
      'but',
      'in',
      'on',
      'at',
      'to',
      'for',
      'of',
      'with',
      'by',
      'from',
      'up',
      'about',
      'into',
      'through',
      'during',
      'before',
      'after',
      'above',
      'below',
      'between',
      'among',
      'is',
      'are',
      'was',
      'were',
      'be',
      'been',
      'being',
      'have',
      'has',
      'had',
      'do',
      'does',
      'did',
      'will',
      'would',
      'could',
      'should',
      'may',
      'might',
      'must',
      'this',
      'that',
      'these',
      'those',
      'i',
      'you',
      'he',
      'she',
      'it',
      'we',
      'they',
      'your',
      'their',
      'our',
      'my',
      'his',
      'her',
      'its',
      'what',
      'which',
      'who',
      'whom',
      'whose',
      'when',
      'where',
      'why',
      'how',
      'all',
      'any',
      'both',
      'each',
      'few',
      'more',
      'most',
      'other',
      'some',
      'such',
      'no',
      'nor',
      'not',
      'only',
      'own',
      'same',
      'so',
      'than',
      'too',
      'very',
      'can',
      'just',
    ]);

    // Extract meaningful terms from diagnosis
    const words = lowerDiagnosis
      .replace(/[^\w\s]/g, ' ') // Remove punctuation
      .split(/\s+/) // Split by whitespace
      .filter(
        (word) =>
          word.length > 2 && // Remove short words
          !stopWords.has(word) && // Remove stop words
          !/^\d+$/.test(word), // Remove pure numbers
      );

    // Prioritize medical and treatment terms
    const priorityTerms = this.getPriorityTerms();
    const prioritizedWords = words.sort((a, b) => {
      const aPriority = priorityTerms.has(a) ? 1 : 0;
      const bPriority = priorityTerms.has(b) ? 1 : 0;
      return bPriority - aPriority;
    });

    // Take top 3-5 most relevant terms
    const mainTerms = prioritizedWords.slice(0, 5);

    return mainTerms.join(' ');
  }

  private getPriorityTerms(): Set<string> {
    return new Set([
      // Medical conditions
      'infection',
      'bacterial',
      'viral',
      'parasitic',
      'fungal',
      'disease',
      'deficiency',
      'nutritional',
      'vitamin',
      'mineral',
      'protein',
      'respiratory',
      'digestive',
      'gastrointestinal',
      'skin',
      'dermal',
      'fever',
      'diarrhea',
      'cough',
      'lameness',
      'weakness',
      'lethargy',
      'inflammation',
      'pain',
      'swelling',
      'lesion',
      'wound',
      'ulcer',

      // Treatments and solutions
      'antibiotic',
      'antimicrobial',
      'antifungal',
      'antiparasitic',
      'dewormer',
      'vaccine',
      'vaccination',
      'vitamin',
      'mineral',
      'supplement',
      'additive',
      'treatment',
      'therapy',
      'medication',
      'drug',
      'prevention',
      'preventive',
      'recovery',
      'boost',
      'strengthen',
      'support',
      'aid',
      'relief',

      // Animal-specific terms
      'poultry',
      'chicken',
      'broiler',
      'layer',
      'cattle',
      'cow',
      'bull',
      'calf',
      'sheep',
      'goat',
      'pig',
      'swine',
      'fish',
      'tilapia',
      'catfish',

      // Symptom-related
      'symptom',
      'sign',
      'condition',
      'issue',
      'problem',
      'sickness',
      'illness',
    ]);
  }

  // Helper method to map animal type strings to AnimalCategory enum
  private mapToAnimalCategory(animalType: string): AnimalCategory {
    const mapping: { [key: string]: AnimalCategory } = {
      poultry: AnimalCategory.POULTRY,
      chicken: AnimalCategory.POULTRY,
      bird: AnimalCategory.POULTRY,
      cattle: AnimalCategory.CATTLE,
      cow: AnimalCategory.CATTLE,
      bull: AnimalCategory.CATTLE,
      calf: AnimalCategory.CATTLE,
      fish: AnimalCategory.FISH,
      tilapia: AnimalCategory.FISH,
      catfish: AnimalCategory.FISH,
      pig: AnimalCategory.PIG,
      swine: AnimalCategory.PIG,
      hog: AnimalCategory.PIG,
      small_ruminant: AnimalCategory.SMALL_RUMINANT,
      sheep: AnimalCategory.SMALL_RUMINANT,
      goat: AnimalCategory.SMALL_RUMINANT,
      rabbit: AnimalCategory.RABBIT,
      snail: AnimalCategory.SNAIL,
      apiculture: AnimalCategory.APICULTURE,
      bee: AnimalCategory.APICULTURE,
      grasscutter: AnimalCategory.GRASSCUTTER,
      dog: AnimalCategory.DOG,
      cat: AnimalCategory.CAT,
    };

    return mapping[animalType.toLowerCase()] || AnimalCategory.POULTRY;
  }
}
