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
  Patch,
} from '@nestjs/common';
import { OrderService } from './order.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { ApiBearerAuth, ApiBody, ApiOperation } from '@nestjs/swagger';
import { CurrentUser } from '../utils/decorators/current-user.decorator';
import { UserEntity } from '../user/entities/user.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Paginate, Paginated, PaginateQuery } from 'nestjs-paginate';
import { OrderEntity } from './entities/order.entity';
import { AdminEntity } from '../admins/entities/admin.entity';
import { AdminAuthGuard } from '../auth/guards/admin.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { RequiredPermissions } from 'src/auth/decorator/required-permission.decorator';
import { UpdateOrderItemDto } from './dto/update-order-item.dto';

@Controller('order')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new order' })
  @ApiBody({ type: CreateOrderDto })
  create(
    @Body() createOrderDto: CreateOrderDto,
    @CurrentUser() user: UserEntity,
  ) {
    return this.orderService.create(createOrderDto, user);
  }

  @Get()
  @ApiOperation({ summary: 'Get User orders' })
  findAll(
    @Paginate() query: PaginateQuery,
    @CurrentUser() user: UserEntity | AdminEntity,
  ): Promise<Paginated<OrderEntity>> {
    return this.orderService.findAll(query, user);
  }

  @Get('monthly-target')
  @ApiOperation({ summary: 'Get monthly target' })
  @UseGuards(JwtAuthGuard, AdminAuthGuard)
  getMonthlyTarget(): Promise<any> {
    return this.orderService.getMonthlyTarget();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get order by ID' })
  findOne(@Param('id') id: string) {
    return this.orderService.findOne(id);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, AdminAuthGuard)
  update(@Param('id') id: string, @Body() updateOrderDto: UpdateOrderDto) {
    return this.orderService.update(id, updateOrderDto);
  }

  @Patch(':id/recieved')
  @ApiOperation({ summary: 'Update order item' })
  @UseGuards(JwtAuthGuard)
  confirmOrderReceived(
    @Param('id') id: string,
    @CurrentUser() user: UserEntity,
  ) {
    return this.orderService.confirmOrderReceived(id, user);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Cancel order' })
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @RequiredPermissions('update_orders')
  cancelOrder(
    @Param('id') id: string,
    @CurrentUser() user: UserEntity | AdminEntity,
  ) {
    return this.orderService.cancelOrder(id, user);
  }

  @Patch(':id/items/:itemId')
  @ApiOperation({ summary: 'Fulfill order item' })
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @RequiredPermissions('update_orders')
  updateOrderItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @CurrentUser() user: AdminEntity,
    @Body() dto: UpdateOrderItemDto,
  ) {
    dto.orderItemId = itemId;
    return this.orderService.updateOrderItem(id, user, dto);
  }
}
