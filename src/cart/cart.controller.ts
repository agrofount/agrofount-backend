import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Put,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { CartService } from './cart.service';
import { AddToCartDto, SyncCartDto } from './dto/create-cart.dto';
import { UpdateCartDto } from './dto/update-cart.dto';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../utils/decorators/current-user.decorator';
import { UserEntity } from '../user/entities/user.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Cart')
@Controller('cart')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CartController {
  private readonly logger = new Logger(CartController.name);

  constructor(private readonly cartService: CartService) {}

  @Post()
  @ApiOperation({ summary: 'Add item to cart' })
  @ApiBody({
    type: AddToCartDto,
    description: 'Json structure for adding item to cart',
  })
  async addToCart(@Body() dto: AddToCartDto, @CurrentUser() user: UserEntity) {
    console.log('this is the user: ', user);
    this.logger.debug(`Add to cart`);

    const cartData = await this.cartService.addToCart(user.id, dto);

    return {
      success: true,
      message: 'Item added to cart',
      cart: cartData,
    };
  }

  @Get()
  async getCart(@CurrentUser() user: UserEntity) {
    const cartData = await this.cartService.getCart(user.id);
    return {
      success: true,
      message: 'Fetch cart successfully',
      cart: cartData,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('sync')
  async syncCart(
    @Body() syncCartDto: SyncCartDto,
    @CurrentUser() user: UserEntity,
  ) {
    this.logger.debug(`sync cart`);
    const userId = user.id;
    return this.cartService.syncCart(userId, syncCartDto.items);
  }

  @Put('')
  @ApiOperation({ summary: 'update cart' })
  @ApiBody({
    type: UpdateCartDto,
    description: 'Json structure for updating cart items',
  })
  updateCart(
    @CurrentUser() user: UserEntity,
    @Body() updateCartDto: UpdateCartDto,
  ) {
    this.logger.debug(`Update cart`);
    return this.cartService.update(user.id, updateCartDto);
  }

  @Delete('')
  @ApiOperation({ summary: 'clear cart' })
  clear(@CurrentUser() user: UserEntity) {
    this.logger.debug(`Clear cart`);
    return this.cartService.clear(user.id);
  }
}
