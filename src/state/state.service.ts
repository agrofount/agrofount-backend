import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CreateStateDto } from './dto/create-state.dto';
import { Not, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { StateEntity } from './entities/state.entity';
import { CountryService } from '../country/country.service';
import { paginate, PaginateQuery } from 'nestjs-paginate';
import { UpdateCountryDto } from '../country/dto/update-country.dto';
import { STATE_PAGINATION_CONFIG } from './config/pagination.config';

@Injectable()
export class StateService {
  constructor(
    @InjectRepository(StateEntity)
    private stateRepo: Repository<StateEntity>,
    private readonly countryService: CountryService,
  ) {}

  async create(dto: CreateStateDto) {
    const { countryId, name } = dto;
    const country = await this.countryService.findOne(countryId);

    // Check if a state with the same name exists, excluding soft-deleted records
    const stateExist = await this.stateRepo.findOne({
      where: { name },
      withDeleted: true, // Include soft-deleted records in the query
    });

    if (stateExist && !stateExist.deletedAt) {
      throw new ConflictException('State already exists');
    }

    if (stateExist && stateExist.deletedAt) {
      // If the record exists but is soft-deleted, restore it
      await this.stateRepo.restore(stateExist.id);

      // Reload the entity to ensure `deletedAt` is updated in memory
      const restoredState = await this.stateRepo.findOne({
        where: { id: stateExist.id },
      });

      if (!restoredState) {
        throw new InternalServerErrorException('Failed to restore the state');
      }

      Object.assign(restoredState, { ...dto, country });
      return this.stateRepo.save(restoredState);
    }

    const state = this.stateRepo.create({ ...dto, country });

    return this.stateRepo.save(state);
  }

  async findAll(query: PaginateQuery) {
    if (!query['filter.country.id']) {
      throw new BadRequestException('countryId is required');
    }

    const where: any = {
      country: {
        id: query['filter.country.id'],
      },
    };

    if (query['filter.isActive'] !== undefined) {
      where.isActive = query['filter.isActive'] === 'true';
    }

    return paginate(query, this.stateRepo, {
      ...STATE_PAGINATION_CONFIG,
      where,
    });
  }

  async findOne(id: string): Promise<StateEntity> {
    const state = await this.stateRepo.findOne({ where: { id } });
    if (!state) {
      throw new NotFoundException(`State with ID ${id} not found`);
    }

    return state;
  }

  async update(id: string, dto: UpdateCountryDto) {
    const state = await this.findOne(id);

    // Check if a country with the same name and code already exists
    const existingCountry = await this.stateRepo.findOne({
      where: [
        { name: dto.name, id: Not(id) },
        { code: dto.code, id: Not(id) },
      ],
      // Exclude the current country being updated
      select: ['id'],
    });

    if (existingCountry && existingCountry.id !== id) {
      throw new BadRequestException(
        'State with the same name or code already exists',
      );
    }

    Object.assign(state, dto);
    return this.stateRepo.save(state);
  }

  async remove(id: string) {
    const state = await this.findOne(id);
    await this.stateRepo.softRemove(state);
  }
}
