import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { RoleEntity } from './entities/role.entity';
import { Repository } from 'typeorm';
import { permissions } from '../permission/Enum/permissions.enum';
import { FilterOperator, paginate, PaginateQuery } from 'nestjs-paginate';

@Injectable()
export class RoleService {
  constructor(
    @InjectRepository(RoleEntity) private roleRepo: Repository<RoleEntity>,
  ) {}
  async createRole(dto: CreateRoleDto) {
    const role = this.roleRepo.create({
      name: dto.name,
      description: dto.description,
      permissions: dto.permissions,
    });
    return this.roleRepo.save(role);
  }

  async getRoles(query: PaginateQuery) {
    return paginate(query, this.roleRepo, {
      sortableColumns: ['id', 'name', 'createdAt'],
      searchableColumns: ['name', 'description'],
      defaultSortBy: [['createdAt', 'DESC']],
      filterableColumns: {
        star: [FilterOperator.EQ],
      },
    });
  }

  async findOne(id: string) {
    try {
      const role = await this.roleRepo.findOneBy({ id });

      if (!role) {
        throw new NotFoundException(`Role location with id ${id} not found`);
      }

      return role;
    } catch (error) {
      console.error('Error parsing custom filters:', error);
      throw new BadRequestException('Error getting role');
    }
  }

  async getPermissions() {
    return permissions;
  }

  async update(id: string, updateRoleDto: UpdateRoleDto) {
    const role = await this.findOne(id);

    // Update the role with the new data
    Object.assign(role, updateRoleDto);

    // Save the updated role
    return this.roleRepo.save(role);
  }

  remove(id: number) {
    return `This action removes a #${id} role`;
  }
}
