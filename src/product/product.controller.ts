import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
  Put,
  Query,
} from '@nestjs/common';
import { ProductService } from './services/product.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { Paginated, PaginateQuery } from 'nestjs-paginate';
import { ProductEntity } from './entities/product.entity';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorator/role.decorator';
import { Role } from '../auth/enums/role.enum';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminAuthGuard } from '../auth/guards/admin.guard';
import { ProductResponseDto } from './dto/product.response.dto';

@ApiTags('Product')
@Controller('product')
@ApiBearerAuth()
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Post()
  @Roles(Role.Admin, Role.Staff)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Create product' })
  @ApiBody({
    type: CreateProductDto,
    description: 'Json structure for creating product',
  })
  create(@Body() createProductDto: CreateProductDto) {
    return this.productService.create(createProductDto);
  }

  @Get()
  @UseGuards(JwtAuthGuard, AdminAuthGuard)
  @ApiOperation({ summary: 'get all product' })
  @ApiBody({
    type: ProductResponseDto,
    description: 'Json structure for getting product',
  })
  findAll(@Query() query: PaginateQuery): Promise<Paginated<ProductEntity>> {
    return this.productService.findAll(query);
  }

  @Get('livestock-feed-categories')
  @ApiOperation({ summary: 'Get Livestock Feed Categories' })
  @ApiOkResponse({ type: Object })
  getLivestockFeedCategories(): Record<
    string,
    Record<string, string[]> | string[]
  > {
    return this.productService.getAgrofountCategories();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.productService.findOne(id);
  }

  @Put(':id')
  @Roles(Role.Admin, Role.Staff)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Update product by ID' })
  update(@Param('id') id: string, @Body() updateProductDto: UpdateProductDto) {
    return this.productService.update(id, updateProductDto);
  }

  @Delete(':id')
  @Roles(Role.Admin, Role.Staff)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Delete product by ID' })
  remove(@Param('id') id: string) {
    return this.productService.remove(id);
  }
}
