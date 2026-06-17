import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
  Query,
  Put,
} from '@nestjs/common';
import { ReviewService } from './review.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserEntity } from '../user/entities/user.entity';
import { CurrentUser } from '../utils/decorators/current-user.decorator';
import { Paginated, PaginateQuery } from 'nestjs-paginate';
import { ReviewEntity } from './entities/review.entity';
import { AdminAuthGuard } from '../auth/guards/admin.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequiredPermissions } from '../auth/decorator/required-permission.decorator';

@Controller('review')
@ApiBearerAuth()
@ApiTags('Review')
export class ReviewController {
  constructor(private readonly reviewService: ReviewService) {}

  @Post('product/:productLocationId')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Create review' })
  @ApiBody({
    type: CreateReviewDto,
    description: 'Json structure for creating review',
  })
  create(
    @Body() dto: CreateReviewDto,
    @Param('productLocationId') productLocationId: string,
    @CurrentUser() user: UserEntity,
  ) {
    dto.userId = user.id;
    dto.productLocationId = productLocationId;
    return this.reviewService.create(dto);
  }

  @Get('')
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @RequiredPermissions('read_reviews')
  @ApiOperation({ summary: 'get all reviews' })
  findAll(@Query() query: PaginateQuery): Promise<Paginated<ReviewEntity>> {
    return this.reviewService.findAll(query);
  }

  @Get('product/:productId')
  @ApiOperation({ summary: 'get product reviews' })
  findAllByProductId(
    @Param('productId') productId: string,
    @Query() query: PaginateQuery,
  ): Promise<Paginated<ReviewEntity>> {
    return this.reviewService.findAllByProductId(productId, query);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Update review' })
  @ApiBody({
    type: UpdateReviewDto,
    description: 'Json structure for updating review',
  })
  update(
    @Param('id') id: string,
    @Body() updateReviewDto: UpdateReviewDto,
    @CurrentUser() user: UserEntity,
  ) {
    return this.reviewService.update(id, updateReviewDto, user.id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @RequiredPermissions('delete_reviews')
  remove(@Param('id') id: string) {
    return this.reviewService.remove(id);
  }
}
