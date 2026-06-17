import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { ReviewEntity } from './entities/review.entity';
import { Repository } from 'typeorm';
import { UserService } from '../user/user.service';
import {
  FilterOperator,
  paginate,
  Paginated,
  PaginateQuery,
} from 'nestjs-paginate';
import { ProductLocationService } from '../product-location/product-location.service';
import { OrderEntity } from '../order/entities/order.entity';
import { OrderStatus } from '../order/enums/order.enum';

@Injectable()
export class ReviewService {
  constructor(
    @InjectRepository(ReviewEntity)
    private readonly reviewRepo: Repository<ReviewEntity>,
    @InjectRepository(OrderEntity)
    private readonly orderRepo: Repository<OrderEntity>,
    private readonly userService: UserService,
    private readonly productLocation: ProductLocationService,
  ) {}
  async create(dto: CreateReviewDto) {
    const { userId, productLocationId, comment, star } = dto;

    const user = await this.userService.findOne(userId);

    const productLocation = await this.productLocation.findById(
      productLocationId,
    );

    const purchased = await this.orderRepo
      .createQueryBuilder('order')
      .select('1')
      .where('order.userId = :userId', { userId })
      .andWhere('order.status = :status', { status: OrderStatus.Delivered })
      .andWhere('order.items::jsonb @> :item::jsonb', {
        item: JSON.stringify([{ id: productLocationId }]),
      })
      .limit(1)
      .getRawOne();
    if (!purchased) {
      throw new ConflictException(
        'Only customers with a delivered order can review this product',
      );
    }

    const reviewExist = await this.reviewRepo.findOne({
      where: {
        productLocation: { id: productLocationId },
        user: { id: userId },
      },
    });

    if (reviewExist) {
      throw new ConflictException('User already reviewed this product');
    }

    const review = this.reviewRepo.create({
      comment,
      fullname: user.username,
      star,
      email: user.email,
      user,
      productLocation,
    });

    try {
      return await this.reviewRepo.save(review);
    } catch (error) {
      if (error?.code === '23505') {
        throw new ConflictException('User already reviewed this product');
      }
      throw error;
    }
  }

  findAll(query: PaginateQuery) {
    return paginate(query, this.reviewRepo, {
      sortableColumns: ['id', 'star', 'createdAt'],
      searchableColumns: ['comment'],
      defaultSortBy: [['createdAt', 'DESC']],
      filterableColumns: {
        star: [FilterOperator.EQ],
      },
      relations: ['user'],
      defaultLimit: 25,
      maxLimit: 100,
    });
  }

  findAllByProductId(
    productLocationId: string,
    query: PaginateQuery,
  ): Promise<Paginated<ReviewEntity>> {
    return paginate(query, this.reviewRepo, {
      sortableColumns: ['id', 'star', 'createdAt'],
      searchableColumns: ['comment'],
      defaultSortBy: [['createdAt', 'DESC']],
      filterableColumns: {
        star: [FilterOperator.EQ],
      },
      where: { productLocation: { id: productLocationId } },
      relations: ['user'],
      defaultLimit: 25,
      maxLimit: 100,
    });
  }

  async findOne(id: string) {
    const review = await this.reviewRepo.findOne({
      where: { id },
      relations: ['user'],
    });

    if (!review) {
      throw new NotFoundException('Review with id ${id} not found');
    }

    return review;
  }

  async update(id: string, dto: UpdateReviewDto, userId: string) {
    const review = await this.findOne(id);

    if (review.user.id !== userId) {
      throw new ConflictException(
        'You are not authorized to update this review',
      );
    }

    if (dto.isHelpful !== undefined) {
      review.isHelpfulCount = Math.max(
        0,
        review.isHelpfulCount + (dto.isHelpful ? 1 : -1),
      );
    }

    if (dto.isReported !== undefined) {
      review.isReportedCount = Math.max(
        0,
        review.isReportedCount + (dto.isReported ? 1 : -1),
      );
    }

    Object.assign(review, dto);
    return this.reviewRepo.save(review);
  }

  async remove(id: string) {
    const city = await this.findOne(id);
    await this.reviewRepo.softRemove(city);
  }
}
