import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateProductDto } from '../dto/create-product.dto';
import { UpdateProductDto } from '../dto/update-product.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { ProductEntity } from '../entities/product.entity';
import { Repository } from 'typeorm';
import {
  FilterOperator,
  paginate,
  Paginated,
  PaginateQuery,
} from 'nestjs-paginate';
import { AgrofountSubCategories } from '../types/product.enum';

@Injectable()
export class ProductService {
  constructor(
    @InjectRepository(ProductEntity)
    private readonly productRepository: Repository<ProductEntity>,
  ) {}
  async create(createProductDto: CreateProductDto) {
    const { name } = createProductDto;

    // Check if a product with the same name already exists
    const existingProduct = await this.productRepository.findOne({
      where: { name },
    });

    if (existingProduct) {
      throw new BadRequestException(
        'Product with the same name already exists',
      );
    }

    const product = this.productRepository.create(createProductDto);
    return this.productRepository.save(product);
  }

  async findAll(query: PaginateQuery): Promise<Paginated<ProductEntity>> {
    return paginate(query, this.productRepository, {
      sortableColumns: ['id', 'name', 'category', 'createdAt'],
      nullSort: 'last',
      searchableColumns: ['name', 'category'],
      defaultSortBy: [['createdAt', 'DESC']],
      filterableColumns: {
        category: [FilterOperator.ILIKE],
        price: [FilterOperator.BTW],
      },
    });
  }

  getAgrofountCategories(): Record<string, string[]> {
    return AgrofountSubCategories;
  }

  async findOne(id: string) {
    const product = await this.productRepository.findOneBy({ id });

    if (!product) {
      throw new NotFoundException(`Product with id ${id} not found`);
    }

    return product;
  }

  async update(id: string, updateProductDto: UpdateProductDto) {
    const product = await this.findOne(id);

    Object.assign(product, updateProductDto);

    return this.productRepository.save(product);
  }

  async remove(id: string) {
    const product = await this.productRepository.findOneBy({ id });
    if (!product) {
      throw new NotFoundException(`Product with id ${id} not found`);
    }

    await this.productRepository.softRemove(product);
  }
}
