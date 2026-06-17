import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Query,
  UseGuards,
  Put,
} from '@nestjs/common';
import { CountryService } from './country.service';
import { CreateCountryDto } from './dto/create-country.dto';
import { UpdateCountryDto } from './dto/update-country.dto';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaginateQuery } from 'nestjs-paginate';
import { AdminAuthGuard } from '../auth/guards/admin.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequiredPermissions } from '../auth/decorator/required-permission.decorator';

@Controller('country')
@ApiTags('country')
export class CountryController {
  constructor(private readonly countryService: CountryService) {}

  @Post()
  @ApiOperation({ summary: 'Create Country' })
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @RequiredPermissions('create_countries')
  @ApiBearerAuth()
  create(@Body() dto: CreateCountryDto) {
    return this.countryService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get All countries' })
  findAll(@Query() query: PaginateQuery) {
    return this.countryService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get country detail' })
  findOne(@Param('id') id: string) {
    return this.countryService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update Country' })
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @RequiredPermissions('update_countries')
  @ApiBearerAuth()
  update(@Param('id') id: string, @Body() dto: UpdateCountryDto) {
    return this.countryService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete Country' })
  @UseGuards(JwtAuthGuard, AdminAuthGuard, RolesGuard)
  @RequiredPermissions('delete_countries')
  @ApiBearerAuth()
  remove(@Param('id') id: string) {
    return this.countryService.remove(id);
  }
}
