import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateCountryDto } from './dto/create-country.dto';
import { UpdateCountryDto } from './dto/update-country.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { CountryEntity } from './entities/country.entity';
import {
  FilterOperator,
  paginate,
  Paginated,
  PaginateQuery,
} from 'nestjs-paginate';

@Injectable()
export class CountryService {
  constructor(
    @InjectRepository(CountryEntity)
    private countryRepo: Repository<CountryEntity>,
  ) {}

  async create(dto: CreateCountryDto) {
    const countryExist = await this.countryRepo.findOne({
      where: { name: dto.name },
    });

    if (countryExist) {
      throw new ConflictException('Country with name already exist');
    }

    const country = this.countryRepo.create(dto);

    return this.countryRepo.save(country);
  }

  async findAll(query: PaginateQuery): Promise<Paginated<CountryEntity>> {
    return paginate(query, this.countryRepo, {
      sortableColumns: ['id', 'isActive', 'createdAt'],
      nullSort: 'last',
      searchableColumns: ['name'],
      defaultSortBy: [['createdAt', 'DESC']],
      filterableColumns: {
        active: [FilterOperator.ILIKE],
      },
    });
  }

  async findOne(id: string): Promise<CountryEntity> {
    const country = await this.countryRepo.findOne({ where: { id } });
    if (!country) {
      throw new NotFoundException(`Country with ID ${id} not found`);
    }

    return country;
  }

  async findOneByName(name: string) {
    const country = await this.countryRepo.findOne({
      where: { name },
    });

    if (!country) {
      throw new NotFoundException('country with name not found');
    }

    return country;
  }

  async update(id: string, dto: UpdateCountryDto) {
    const country = await this.findOne(id);

    // Check if a country with the same name and code already exists
    const existingCountry = await this.countryRepo.findOne({
      where: [
        { name: dto.name, id: Not(id) },
        { code: dto.code, id: Not(id) },
      ],
      // Exclude the current country being updated
      select: ['id'],
    });

    if (existingCountry && existingCountry.id !== id) {
      throw new BadRequestException(
        'Country with the same name or code already exists',
      );
    }

    Object.assign(country, dto);
    return this.countryRepo.save(country);
  }

  async remove(id: string) {
    const country = await this.findOne(id);
    await this.countryRepo.softRemove(country);
  }
}
