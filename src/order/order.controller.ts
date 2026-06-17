import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Put,
  Patch,
  Headers,
  BadRequestException,
  ParseArrayPipe,
  ParseUUIDPipe,
} from '@nestjs/common';
import { OrderService } from './order.service';
import { CreateOrderDto, OrderItemDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { ApiBearerAuth, ApiBody, ApiOperation } from '@nestjs/swagger';
import { CurrentUser } from '../utils/decorators/current-user.decorator';
import { UserEntity } from '../user/entities/user.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Paginate, Paginated, PaginateQuery } from 'nestjs-paginate';
import { OrderEntity } from './entities/order.entity';
import { AdminEntity } from '../admins/entities/admin.entity';
import { AdminAuthGuard } from '../auth/guards/admin.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequiredPermissions } from '../auth/decorator/required-permission.decorator';
import { UpdateOrderItemDto } from './dto/update-order-item.dto';
import { UserAuthGuard } from '../auth/guards/user.guard';
import { StepUpGuard } from '../auth/guards/step-up.guard';

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
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const key = idempotencyKey || createOrderDto.idempotencyKey;
    if (
      !key ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        key,
      )
    ) {
      throw new BadRequestException(
        'A valid UUID Idempotency-Key header is required',
      );
    }
    createOrderDto.idempotencyKey = key;
    return this.orderService.create(createOrderDto, user);
  }

  @Get()
  @UseGuards(UserAuthGuard)
  @ApiOperation({ summary: 'Get User orders' })
  findAll(
    @Paginate() query: PaginateQuery,
    @CurrentUser() user: UserEntity,
  ): Promise<Paginated<OrderEntity>> {
    return this.orderService.findAll(query, user);
  }

  @Get('admin/all')
  @UseGuards(AdminAuthGuard, RolesGuard)
  @RequiredPermissions('read_orders')
  findAllForAdmin(
    @Paginate() query: PaginateQuery,
    @CurrentUser() admin: AdminEntity,
  ): Promise<Paginated<OrderEntity>> {
    return this.orderService.findAll(query, admin);
  }

  @Get('monthly-target')
  @ApiOperation({ summary: 'Get monthly target' })
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @RequiredPermissions('read_orders')
  getMonthlyTarget(): Promise<any> {
    return this.orderService.getMonthlyTarget();
  }

  @Get(':id')
  @UseGuards(UserAuthGuard)
  @ApiOperation({ summary: 'Get order by ID' })
  findOne(@Param('id') id: string, @CurrentUser() user: UserEntity) {
    return this.orderService.findOne(id, user);
  }

  @Get('admin/:id')
  @UseGuards(AdminAuthGuard, RolesGuard)
  @RequiredPermissions('read_orders')
  findOneForAdmin(@Param('id') id: string) {
    return this.orderService.findOne(id);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard, StepUpGuard)
  @RequiredPermissions('update_orders')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateOrderDto: UpdateOrderDto,
  ) {
    return this.orderService.update(id, updateOrderDto);
  }

  @Post(':id/items')
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard, StepUpGuard)
  @RequiredPermissions('update_orders')
  @ApiOperation({ summary: 'Add items to an existing order' })
  addItems(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ParseArrayPipe({ items: OrderItemDto }))
    dto: OrderItemDto[],
    @CurrentUser() admin: AdminEntity,
  ) {
    return this.orderService.addItems(id, dto, admin);
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
  @UseGuards(UserAuthGuard)
  cancelOrder(@Param('id') id: string, @CurrentUser() user: UserEntity) {
    return this.orderService.cancelOrder(id, user);
  }

  @Patch('admin/:id/cancel')
  @UseGuards(AdminAuthGuard, RolesGuard, StepUpGuard)
  @RequiredPermissions('cancel_orders')
  cancelOrderForAdmin(
    @Param('id') id: string,
    @CurrentUser() admin: AdminEntity,
  ) {
    return this.orderService.cancelOrder(id, admin);
  }

  @Patch(':id/items/:itemId')
  @ApiOperation({ summary: 'Fulfill order item' })
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard, StepUpGuard)
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
