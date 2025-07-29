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

@Injectable()
export class ReviewService {
  constructor(
    @InjectRepository(ReviewEntity)
    private readonly reviewRepo: Repository<ReviewEntity>,
    private readonly userService: UserService,
    private readonly productLocation: ProductLocationService,
  ) {}
  async create(dto: CreateReviewDto) {
    const { userId, productLocationId, comment, email, fullname, star } = dto;

    const user = await this.userService.findOne(userId);

    const productLocation = await this.productLocation.findOne(
      productLocationId,
    );

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
      fullname,
      star,
      email,
      user,
      productLocation,
    });

    return this.reviewRepo.save(review);
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
    });
  }

  async findOne(id: string) {
    const review = await this.reviewRepo.findOneBy({ id });

    if (!review) {
      throw new NotFoundException('Review with id ${id} not found');
    }

    return review;
  }

  async update(id: string, dto: UpdateReviewDto) {
    const review = await this.findOne(id);

    if (dto.isHelpful !== undefined) {
      review.isHelpfulCount += dto.isHelpful ? 1 : -1;
    }

    if (dto.isReported !== undefined) {
      review.isReportedCount += dto.isReported ? 1 : -1;
    }

    Object.assign(review, dto);
    return this.reviewRepo.save(review);
  }

  async remove(id: string) {
    const city = await this.findOne(id);
    await this.reviewRepo.softRemove(city);
  }
}
