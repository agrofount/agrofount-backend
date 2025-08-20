import {
  Controller,
  Post,
  Delete,
  Param,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { CurrentUser } from '../utils/decorators/current-user.decorator';
import { ProductLikesService } from './product-location-like.service';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

@Controller('likes')
@ApiTags('Product Likes')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ProductLikesController {
  constructor(private readonly likesService: ProductLikesService) {}

  @Post(':productLocationId/like')
  async like(
    @Param('productLocationId') productLocationId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.likesService.like(productLocationId, userId);
  }

  @Delete(':productLocationId/like')
  async unlike(
    @Param('productLocationId') productLocationId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.likesService.unlike(productLocationId, userId);
  }

  @Get(':productLocationId/is-liked')
  async isLiked(
    @Param('productLocationId') productLocationId: string,
    @CurrentUser('id') userId: string,
  ) {
    const liked = await this.likesService.isLiked(productLocationId, userId);
    return { liked };
  }

  @Get('me/likes')
  async myLikes(
    @CurrentUser('id') userId: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.likesService.listMyLikes(userId, Number(page), Number(limit));
  }

  @Get('trending')
  async trending(@Query('days') days = '7', @Query('limit') limit = '20') {
    return this.likesService.trending(Number(days), Number(limit));
  }
}
