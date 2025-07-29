import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CreateAdminDto } from './dto/create-admin.dto';
import { UpdateAdminDto } from './dto/update-admin.dto';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AdminEntity } from './entities/admin.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { NotificationService } from '../notification/notification.service';
import {
  MessageTypes,
  NotificationChannels,
} from '../notification/types/notification.type';
import { plainToClass, plainToInstance } from 'class-transformer';
import { RegisterUserDto } from '../auth/dto/create-user.dto';
import { AdminResponseDto } from './admin.response.dto';
import { Role, UserTypes } from '../auth/enums/role.enum';
import {
  FilterOperator,
  paginate,
  Paginated,
  PaginateQuery,
} from 'nestjs-paginate';
import { RoleEntity } from 'src/role/entities/role.entity';

@Injectable()
export class AdminsService {
  constructor(
    @InjectRepository(AdminEntity)
    private adminRepo: Repository<AdminEntity>,
    @InjectRepository(RoleEntity)
    private roleRepo: Repository<RoleEntity>,
    private jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly notificationService: NotificationService,
  ) {}

  create(createAdminDto: CreateAdminDto) {
    return 'This action adds a new admin';
  }

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

  async update(id: string, dto: UpdateAdminDto) {
    const user = await this.adminRepo.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`Admin with ID ${id} not found`);
    }

    if (dto.roleIds) {
      const roles = await this.roleRepo.findBy({ id: In(dto.roleIds) });
      if (roles.length !== dto.roleIds.length) {
        throw new BadRequestException('One or more roles are invalid');
      }
      dto.roles = roles;
    }
    // Merge the existing user with the updated data
    Object.assign(user, dto);

    // Save the updated user
    const updatedUser = await this.adminRepo.save(user);

    console.log('Updated user:', updatedUser);

    // Transform the updated user to exclude sensitive fields
    const admin = plainToInstance(AdminEntity, updatedUser);
    return admin;
  }

  remove(id: number) {
    return `This action removes a #${id} admin`;
  }

  async register(
    dto: RegisterUserDto,
    user: AdminEntity,
  ): Promise<Partial<AdminEntity>> {
    try {
      const { email, roleIds } = dto;

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

      if (
        user.roles.some((role) => role.name === Role.SuperAdmin) &&
        user.userType !== UserTypes.System
      ) {
        throw new BadRequestException(
          'You are not authorized to create a super admin',
        );
      }

      const verificationToken = Math.random().toString(36).substring(2, 15);

      const admin = this.adminRepo.create({
        ...dto,
        verificationToken,
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

      this.notificationService.sendNotification(
        NotificationChannels.EMAIL,
        { email, userId: admin.id },
        MessageTypes.ADMIN_INVITE,
        {
          admin_name: savedUser.firstname,
          invitation_link: verificationUrl,
        },
      );

      return plainToInstance(AdminEntity, admin);
    } catch (error) {
      Logger.error(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async verifyEmail(token: string): Promise<any> {
    const user = await this.adminRepo.findOne({
      where: { verificationToken: token },
    });
    if (!user) throw new Error('Invalid token');

    user.isVerified = true;
    user.verificationToken = null;
    await this.adminRepo.save(user);

    const payload = { email: user.email, id: user.id };
    return payload;
  }

  async validateAdmin(
    email: string,
    passwd: string,
  ): Promise<Partial<AdminEntity> | null> {
    const user = await this.adminRepo.findOneBy({ email });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.isVerified) {
      throw new BadRequestException('Please verify your email');
    }

    const isValid = await bcrypt.compare(passwd, user.password);
    if (!isValid) {
      throw new BadRequestException('Invalid password');
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, ...result } = user;

    return result;
  }
}
