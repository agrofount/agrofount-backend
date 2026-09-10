import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminAuthGuard } from '../auth/guards/admin.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequiredPermissions } from '../auth/decorator/required-permission.decorator';
import { LogisticsPricingService } from './logistics-pricing.service';
import { CreateLogisticsPricingDto } from './dto/create-logistics-pricing.dto';
import { UpdateLogisticsPricingDto } from './dto/update-logistics-pricing.dto';

@ApiTags('Logistics Pricing')
@ApiBearerAuth()
@Controller('logistics-pricing')
@UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
export class LogisticsPricingController {
  constructor(
    private readonly logisticsPricingService: LogisticsPricingService,
  ) {}

  @Post()
  @RequiredPermissions('create_logisticsPricing')
  @ApiOperation({ summary: 'Create logistics pricing for a state/category' })
  create(@Body() dto: CreateLogisticsPricingDto) {
    return this.logisticsPricingService.create(dto);
  }

  @Get()
  @RequiredPermissions('read_logisticsPricing')
  @ApiOperation({ summary: 'List logistics pricing rules' })
  @ApiQuery({ name: 'stateId', required: false })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  findAll(
    @Query('stateId') stateId?: string,
    @Query('isActive') isActive?: string,
  ) {
    return this.logisticsPricingService.findAll({
      stateId,
      isActive: isActive === undefined ? undefined : isActive === 'true',
    });
  }

  @Get(':id')
  @RequiredPermissions('read_logisticsPricing')
  @ApiOperation({ summary: 'Get a logistics pricing rule' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.logisticsPricingService.findOne(id);
  }

  @Patch(':id')
  @RequiredPermissions('update_logisticsPricing')
  @ApiOperation({ summary: 'Update a logistics pricing rule' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLogisticsPricingDto,
  ) {
    return this.logisticsPricingService.update(id, dto);
  }

  @Delete(':id')
  @RequiredPermissions('delete_logisticsPricing')
  @ApiOperation({ summary: 'Delete a logistics pricing rule' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.logisticsPricingService.remove(id);
  }
}
