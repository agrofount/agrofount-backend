import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InviteAdminDto } from './dto/create-admin.dto';
import { UpdateAdminDto } from './dto/update-admin.dto';
import * as bcrypt from 'bcryptjs';
import { AdminEntity } from './entities/admin.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThan, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { NotificationService } from '../notification/notification.service';
import {
  MessageTypes,
  NotificationChannels,
} from '../notification/types/notification.type';
import { plainToInstance } from 'class-transformer';
import { AdminResponseDto } from './admin.response.dto';
import { Role, UserTypes } from '../auth/enums/role.enum';
import {
  FilterOperator,
  paginate,
  Paginated,
  PaginateQuery,
} from 'nestjs-paginate';
import { RoleEntity } from '../role/entities/role.entity';
import { createHash, randomBytes } from 'crypto';

@Injectable()
export class AdminsService {
  constructor(
    @InjectRepository(AdminEntity)
    private adminRepo: Repository<AdminEntity>,
    @InjectRepository(RoleEntity)
    private roleRepo: Repository<RoleEntity>,
    private readonly configService: ConfigService,
    private readonly notificationService: NotificationService,
  ) {}

  async findAll(query: PaginateQuery): Promise<Paginated<AdminEntity>> {
    const result = await paginate(query, this.adminRepo, {
      sortableColumns: ['id', 'firstname', 'lastname', 'username', 'email'],
      nullSort: 'last',
      searchableColumns: ['firstname', 'lastname', 'username', 'email'],
      defaultSortBy: [['createdAt', 'DESC']],
      filterableColumns: {
        firstname: [FilterOperator.ILIKE],
        lastname: [FilterOperator.ILIKE],
        roles: [FilterOperator.EQ],
        position: [FilterOperator.EQ],
        department: [FilterOperator.EQ],
      },
      relations: ['roles'],
      defaultLimit: 25,
      maxLimit: 100,
    });

    // Transform items so @Exclude takes effect
    result.data = plainToInstance(AdminEntity, result.data);

    return result;
  }

  async findOne(id: string): Promise<AdminEntity> {
    const user = await this.adminRepo.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`Admin with ID ${id} not found`);
    }
    // Transform items so @Exclude takes effect
    const admin = plainToInstance(AdminEntity, user);
    return admin;
  }

  async getProfile(id: string): Promise<AdminResponseDto> {
    const user = await this.adminRepo.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`Admin with ID ${id} not found`);
    }
    return new AdminResponseDto(user);
  }

  async update(id: string, dto: UpdateAdminDto, actor: AdminEntity) {
    const user = await this.adminRepo.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`Admin with ID ${id} not found`);
    }

    if (dto.roleIds) {
      const roles = await this.roleRepo.findBy({ id: In(dto.roleIds) });
      if (roles.length !== dto.roleIds.length) {
        throw new BadRequestException('One or more roles are invalid');
      }
      this.assertSuperAdminChangeAllowed(actor, user, roles);
      dto.roles = roles;
    }
    const changes = { ...dto };
    delete changes.roleIds;
    delete changes.roles;
    Object.assign(user, changes);
    if (dto.roles) user.roles = dto.roles;

    // Save the updated user
    const updatedUser = await this.adminRepo.save(user);

    // Transform the updated user to exclude sensitive fields
    const admin = plainToInstance(AdminEntity, updatedUser);
    return admin;
  }

  async remove(id: string, actor: AdminEntity) {
    const admin = await this.adminRepo.findOneBy({ id });
    if (!admin) {
      throw new NotFoundException(`Admin with id ${id} not found`);
    }

    if (actor.id === id) {
      throw new BadRequestException('You cannot delete your own admin account');
    }
    this.assertSuperAdminChangeAllowed(actor, admin, []);

    await this.adminRepo.softRemove(admin);
  }

  async register(
    dto: InviteAdminDto,
    user: AdminEntity,
  ): Promise<Partial<AdminEntity>> {
    try {
      const { email, roleIds, firstname, lastname, username, phone, password } =
        dto;

      const userExist = await this.adminRepo.findOne({
        where: { email: email },
      });

      if (userExist) {
        throw new BadRequestException(
          'Email or username is already choosen, please choose a new one.',
        );
      }

      // Fetch roles from the database
      const roles = await this.roleRepo.findBy({ id: In(roleIds) });

      if (roles.length !== roleIds.length) {
        throw new BadRequestException('One or more roles are invalid');
      }

      const assigningSuperAdmin = roles.some(
        (role) => role.name === Role.SuperAdmin,
      );
      const inviterIsSuperAdmin = user.roles.some(
        (role) => role.name === Role.SuperAdmin,
      );
      if (assigningSuperAdmin && !inviterIsSuperAdmin) {
        throw new BadRequestException(
          'You are not authorized to create a super admin',
        );
      }

      const verificationToken = randomBytes(32).toString('hex');

      const admin = this.adminRepo.create({
        firstname,
        lastname,
        username,
        phone,
        password,
        email: email.trim().toLowerCase(),
        verificationToken: createHash('sha256')
          .update(verificationToken)
          .digest('hex'),
        verificationTokenExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
        createdBy: user.id,
        userType: UserTypes.System,
        roles,
      });
      const savedUser = await this.adminRepo.save(admin);

      if (!savedUser) {
        throw new BadRequestException('User not created');
      }

      const frontendUrl = this.configService.get<string>(
        'app.admin_frontend_url',
      );
      const verificationUrl = `${frontendUrl}/verify-email?token=${verificationToken}`;

      void this.notificationService
        .sendNotification(
          NotificationChannels.EMAIL,
          { email, userId: admin.id },
          MessageTypes.ADMIN_INVITE,
          {
            admin_name: savedUser.firstname,
            invitation_link: verificationUrl,
          },
        )
        .catch((error) =>
          Logger.error('Failed to send admin invitation', error),
        );

      return plainToInstance(AdminEntity, admin);
    } catch (error: any) {
      Logger.error(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async verifyEmail(token: string): Promise<any> {
    const user = await this.adminRepo.findOne({
      where: {
        verificationToken: createHash('sha256').update(token).digest('hex'),
        verificationTokenExpires: MoreThan(new Date()),
      },
    });
    if (!user) throw new BadRequestException('Invalid or expired token');

    user.isVerified = true;
    user.verificationToken = null;
    user.verificationTokenExpires = null;
    await this.adminRepo.save(user);

    const payload = { email: user.email, id: user.id };
    return payload;
  }

  async validateAdmin(
    email: string,
    passwd: string,
  ): Promise<Partial<AdminEntity> | null> {
    const user = await this.adminRepo.findOneBy({ email });

    const fallbackHash =
      '$2a$12$JqSH7uOEpRsz4l9XfX.6Oel3lUo.BSgMQC3AvOSMEyeM9FjKQFnj2';
    const isValid = await bcrypt.compare(
      passwd,
      user?.password || fallbackHash,
    );
    if (!user || !user.isVerified || !isValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, mfaSecretEncrypted, mfaRecoveryCodeHashes, ...result } =
      user;

    return result;
  }

  private assertSuperAdminChangeAllowed(
    actor: AdminEntity,
    target: AdminEntity,
    nextRoles: RoleEntity[],
  ): void {
    const actorIsSuperAdmin = actor.roles?.some(
      (role) => role.name === Role.SuperAdmin,
    );
    const touchesSuperAdmin =
      target.roles?.some((role) => role.name === Role.SuperAdmin) ||
      nextRoles.some((role) => role.name === Role.SuperAdmin);

    if (touchesSuperAdmin && !actorIsSuperAdmin) {
      throw new BadRequestException(
        'Only a super admin can modify a super admin account',
      );
    }
  }
}
