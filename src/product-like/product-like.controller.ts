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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserEntity } from 'src/user/entities/user.entity';
import { ProductLikeService } from './product-like.service';

@Controller('likes')
@ApiTags('Product Likes')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ProductLikeController {
  constructor(private readonly likesService: ProductLikeService) {}

  @Post(':productLocationId/like')
  async like(
    @Param('productLocationId') productLocationId: string,
    @CurrentUser() user: UserEntity,
  ) {
    return this.likesService.like(productLocationId, user.id);
  }

  @Delete(':productLocationId/like')
  async unlike(
    @Param('productLocationId') productLocationId: string,
    @CurrentUser() user: UserEntity,
  ) {
    return this.likesService.unlike(productLocationId, user.id);
  }

  @Get(':productLocationId/is-liked')
  async isLiked(
    @Param('productLocationId') productLocationId: string,
    @CurrentUser() user: UserEntity,
  ) {
    const liked = await this.likesService.isLiked(productLocationId, user.id);
    return { liked };
  }

  @Get('me/likes')
  async myLikes(
    @CurrentUser() user: UserEntity,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.likesService.listMyLikes(user.id, Number(page), Number(limit));
  }

  @Get('trending')
  async trending(@Query('days') days = '7', @Query('limit') limit = '20') {
    return this.likesService.trending(Number(days), Number(limit));
  }
}
