import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminAuthGuard } from '../auth/guards/admin.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequiredPermissions } from '../auth/decorator/required-permission.decorator';
import { AdjustInventoryDto } from './dto/adjust-inventory.dto';
import { InventoryService } from './inventory.service';

@Controller('inventory')
@UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get(':productLocationId')
  @RequiredPermissions('read_inventory')
  findForProduct(@Param('productLocationId') productLocationId: string) {
    return this.inventoryService.findForProduct(productLocationId);
  }

  @Put()
  @RequiredPermissions('adjust_stock_inventory')
  setAvailable(@Body() dto: AdjustInventoryDto) {
    return this.inventoryService.setAvailable(dto);
  }
}
