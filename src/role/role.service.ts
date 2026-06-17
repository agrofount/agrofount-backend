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
import { ACTIONS } from '../permission/Enum/permissions.enum';
import { FilterOperator, paginate, PaginateQuery } from 'nestjs-paginate';
import { AdminEntity } from '../admins/entities/admin.entity';
import { Role } from '../auth/enums/role.enum';

@Injectable()
export class RoleService {
  constructor(
    @InjectRepository(RoleEntity) private roleRepo: Repository<RoleEntity>,
  ) {}
  async createRole(dto: CreateRoleDto, actor: AdminEntity) {
    this.assertCanManageRole(actor, dto.name, dto.permissions);
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
      defaultLimit: 25,
      maxLimit: 100,
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

  async update(id: string, updateRoleDto: UpdateRoleDto, actor: AdminEntity) {
    const role = await this.findOne(id);
    this.assertCanManageRole(
      actor,
      updateRoleDto.name || role.name,
      updateRoleDto.permissions || role.permissions,
    );

    // Update the role with the new data
    Object.assign(role, updateRoleDto);

    // Save the updated role
    return this.roleRepo.save(role);
  }

  async remove(id: string, actor: AdminEntity): Promise<void> {
    const role = await this.findOne(id);
    this.assertCanManageRole(actor, role.name, role.permissions);
    if (role.name === Role.SuperAdmin) {
      throw new BadRequestException('The super admin role cannot be deleted');
    }
    await this.roleRepo.remove(role);
  }

  private assertCanManageRole(
    actor: AdminEntity,
    roleName: string,
    grants: { resource: string; actions: string[] }[],
  ): void {
    const isSuperAdmin = actor.roles?.some(
      (role) => role.name === Role.SuperAdmin,
    );
    if (isSuperAdmin) return;
    if (roleName === Role.SuperAdmin) {
      throw new BadRequestException('Only a super admin can manage this role');
    }

    const actorGrants = actor.roles?.flatMap((role) => role.permissions || []);
    const allowed = grants.every((grant) => {
      const actorGrant = actorGrants?.find(
        (candidate) => candidate.resource === grant.resource,
      );
      if (!actorGrant) return false;
      return grant.actions.every(
        (action) =>
          actorGrant.actions.includes(action) ||
          actorGrant.actions.includes(ACTIONS.MANAGE),
      );
    });
    if (!allowed) {
      throw new BadRequestException(
        'You cannot grant permissions that you do not hold',
      );
    }
  }
}
