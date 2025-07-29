import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateCityDto } from './dto/create-city.dto';
import { UpdateCityDto } from './dto/update-city.dto';
import { FilterOperator, paginate, PaginateQuery } from 'nestjs-paginate';
import { InjectRepository } from '@nestjs/typeorm';
import { CityEntity } from './entities/city.entity';
import { Repository } from 'typeorm';
import { StateService } from '../state/state.service';

@Injectable()
export class CityService {
  constructor(
    @InjectRepository(CityEntity)
    private cityRepo: Repository<CityEntity>,
    private readonly stateService: StateService,
  ) {}
  async create(dto: CreateCityDto) {
    const { stateId, name } = dto;
    const state = await this.stateService.findOne(stateId);

    const cityExist = await this.cityRepo.findOne({ where: { name } });

    if (cityExist) {
      throw new ConflictException('City already exist');
    }

    const city = this.cityRepo.create({ ...dto, state });

    return this.cityRepo.save(city);
  }

  findAll(query: PaginateQuery) {
    if (!query['filter.state.id']) {
      throw new BadRequestException('stateId is required');
    }

    const where: any = {
      state: {
        id: query['filter.state.id'],
      },
    };

    if (query['filter.isActive'] !== undefined) {
      where.isActive = query['filter.isActive'] === 'true';
    }

    return paginate(query, this.cityRepo, {
      sortableColumns: ['id', 'isActive', 'createdAt'],
      nullSort: 'last',
      searchableColumns: ['name'],
      defaultSortBy: [['createdAt', 'DESC']],
      relations: ['state', 'state.country'],
      filterableColumns: {
        active: [FilterOperator.ILIKE],
        'state.id': [FilterOperator.EQ],
      },
      where,
    });
  }

  async findOne(id: string): Promise<CityEntity> {
    const city = await this.cityRepo.findOne({ where: { id } });
    if (!city) {
      throw new NotFoundException(`City with ID ${id} not found`);
    }
    return city;
  }

  async update(id: string, dto: UpdateCityDto) {
    const city = await this.findOne(id);
    Object.assign(city, dto);
    return this.cityRepo.save(city);
  }

  async remove(id: string) {
    const city = await this.findOne(id);
    await this.cityRepo.softRemove(city);
  }
}
