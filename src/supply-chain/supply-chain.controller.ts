import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Patch,
  UseGuards,
  Delete,
} from '@nestjs/common';
import { SupplyChainService } from './supply-chain.service';
import { ShipmentEntity, ShipmentStatus } from './entities/shipment.entity';
import { CurrentUser } from 'src/utils/decorators/current-user.decorator';
import { AdminEntity } from 'src/admins/entities/admin.entity';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { RequiredPermissions } from 'src/auth/decorator/required-permission.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { AdminAuthGuard } from 'src/auth/guards/admin.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { ApiBody, ApiResponse } from '@nestjs/swagger';
import { CreateDriverDto } from './dto/create-driver.dto';
import { Paginate, Paginated, PaginateQuery } from 'nestjs-paginate';
import { DriverEntity } from './entities/driver.entity';

@Controller('supply-chain')
export class SupplyChainController {
  constructor(private readonly supplyChainService: SupplyChainService) {}

  @Post('driver')
  @ApiResponse({
    status: 201,
    description: 'Driver created successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @ApiBody({ type: CreateDriverDto })
  @RequiredPermissions('create_drivers')
  async createDriver(
    @Body() body: CreateDriverDto,
    @CurrentUser() user: AdminEntity,
  ) {
    return this.supplyChainService.createDriver(body, user);
  }

  @Get('drivers')
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @RequiredPermissions('read_drivers')
  async listDrivers(
    @Paginate() query: PaginateQuery,
  ): Promise<Paginated<DriverEntity>> {
    return this.supplyChainService.listDrivers(query);
  }

  @Delete('drivers/:id')
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @RequiredPermissions('delete_drivers')
  async deleteDriver(@Param('id') id: string) {
    return this.supplyChainService.softDeleteDriver(id);
  }

  @Get('shipments')
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @RequiredPermissions('read_shipments')
  async listShipments(
    @Paginate() query: PaginateQuery,
  ): Promise<Paginated<ShipmentEntity>> {
    return this.supplyChainService.listShipments(query);
  }

  @Post('shipments')
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @RequiredPermissions('create_shipments')
  create(
    @Body() createShipmentDto: CreateShipmentDto,
    @CurrentUser() user: AdminEntity,
  ) {
    return this.supplyChainService.createShipment(createShipmentDto, user);
  }

  @Patch('shipment/:id/status')
  async updateShipmentStatus(
    @Param('id') shipmentId: string,
    @Body('status') status: ShipmentStatus,
  ) {
    return this.supplyChainService.updateShipmentStatus(shipmentId, status);
  }

  @Get('order/:orderId/shipments')
  async getShipmentsByOrder(@Param('orderId') orderId: string) {
    return this.supplyChainService.getShipmentsByOrder(orderId);
  }
}
