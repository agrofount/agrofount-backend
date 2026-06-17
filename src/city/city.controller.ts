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
import { CityService } from './city.service';
import { CreateCityDto } from './dto/create-city.dto';
import { UpdateCityDto } from './dto/update-city.dto';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard } from '../auth/guards/admin.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PaginateQuery } from 'nestjs-paginate';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequiredPermissions } from '../auth/decorator/required-permission.decorator';

@Controller('city')
@ApiTags('city')
export class CityController {
  constructor(private readonly cityService: CityService) {}

  @Post()
  @ApiOperation({ summary: 'Create city' })
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @RequiredPermissions('create_cities')
  @ApiBearerAuth()
  create(@Body() dto: CreateCityDto) {
    return this.cityService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get All state cities' })
  findAll(@Query() query: PaginateQuery) {
    return this.cityService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get city detail' })
  findOne(@Param('id') id: string) {
    return this.cityService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update cities' })
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @RequiredPermissions('update_cities')
  update(@Param('id') id: string, @Body() updateCityDto: UpdateCityDto) {
    return this.cityService.update(id, updateCityDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove cities' })
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @RequiredPermissions('delete_cities')
  remove(@Param('id') id: string) {
    return this.cityService.remove(id);
  }
}
