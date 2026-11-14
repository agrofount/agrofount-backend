import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { UserEntity } from './entities/user.entity';
import { OrderEntity } from '../order/entities/order.entity';
import { DataSource, In, Like, Repository } from 'typeorm';
import { PaymentEntity } from '../payment/entities/payment.entity';
import { PaymentStatus } from '../payment/enum/payment.enum';
import { WalletEntity } from '../wallet/entities/wallet.entity';
import {
  VoucherEntity,
  VoucherStatus,
} from '../voucher/entities/voucher.entity';
import { InjectRepository } from '@nestjs/typeorm';
import {
  FilterOperator,
  paginate,
  PaginateConfig,
  Paginated,
  PaginateQuery,
} from 'nestjs-paginate';
import { plainToInstance } from 'class-transformer';
import { LivestockFarmerProfile } from './entities/profile.entity';
import { FarmLocation } from './entities/location.entity';
import { ContactInformation } from './entities/contact.entity';
import { LivestockBreed } from './entities/breed.entity';
import {
  BreedDto,
  ContactDto,
  CreateLivestockFarmerDto,
  LocationDto,
} from './dto/create-profile.dto';
import { UpdateLivestockFarmerDto } from './dto/update-profile.dto';
import { UpdateBasicUserDetailDto } from './dto/UpdateBasicUserDetail.dto';
import { AdminEntity } from '../admins/entities/admin.entity';
import { Role, UserTypes } from '../auth/enums/role.enum';
import { ACTIONS, RESOURCES } from '../permission/Enum/permissions.enum';

const REFERRAL_LIST_LIMIT = 100;

type UserRemovalActor = UserEntity | AdminEntity;

@Injectable()
export class UserService {
  constructor(
    private dataSource: DataSource,
    @InjectRepository(UserEntity)
    private userRepo: Repository<UserEntity>,
  ) {}

  async createProfile(
    createLivestockFarmerDto: CreateLivestockFarmerDto,
    user: UserEntity,
  ): Promise<LivestockFarmerProfile> {
    return this.dataSource.transaction(async (transactionalEntityManager) => {
      const profileRepo = transactionalEntityManager.getRepository(
        LivestockFarmerProfile,
      );
      const locationRepo =
        transactionalEntityManager.getRepository(FarmLocation);
      const contactRepo =
        transactionalEntityManager.getRepository(ContactInformation);
      const breedRepo =
        transactionalEntityManager.getRepository(LivestockBreed);

      // Check if profile exists within the transaction
      let farmer = await profileRepo.findOne({
        where: { user: { id: user.id } },
        relations: ['locations', 'contacts', 'breeds'],
      });

      // Prepare profile data
      const profileData = {
        ...createLivestockFarmerDto,
        establishmentDate: createLivestockFarmerDto.establishmentDate
          ? new Date(createLivestockFarmerDto.establishmentDate)
          : undefined,
      };

      if (farmer) {
        // Update existing profile
        farmer = profileRepo.merge(farmer, profileData);
      } else {
        // Create new profile
        farmer = profileRepo.create({
          ...profileData,
          user,
        });
      }

      // Save the profile first
      const savedFarmer = await profileRepo.save(farmer);

      user.profile = savedFarmer;
      user.profileId = savedFarmer.id;
      await transactionalEntityManager.getRepository(UserEntity).save(user);

      // Process locations
      if (createLivestockFarmerDto.locations?.length) {
        await locationRepo.delete({
          farmerProfile: { id: savedFarmer.id },
        });
        const locations = createLivestockFarmerDto.locations.map((location) =>
          locationRepo.create({
            ...location,
            farmerProfile: savedFarmer,
          }),
        );
        await locationRepo.save(locations);
      }

      // Process contacts
      if (createLivestockFarmerDto.contacts?.length) {
        await contactRepo.delete({
          farmerProfile: { id: savedFarmer.id },
        });

        // Handle primary contact logic
        const hasPrimary = createLivestockFarmerDto.contacts.some(
          (c) => c.isPrimary,
        );
        const normalizedContacts = createLivestockFarmerDto.contacts.map(
          (contact) => ({
            ...contact,
            isPrimary: hasPrimary ? contact.isPrimary : false,
          }),
        );

        const contacts = normalizedContacts.map((contact) =>
          contactRepo.create({
            ...contact,
            farmerProfile: savedFarmer,
          }),
        );
        await contactRepo.save(contacts);
      }

      // Process breeds
      if (createLivestockFarmerDto.breeds?.length) {
        await breedRepo.delete({
          farmerProfile: { id: savedFarmer.id },
        });

        const breeds = createLivestockFarmerDto.breeds.map((breed) =>
          breedRepo.create({
            ...breed,
            farmerProfile: savedFarmer,
          }),
        );
        await breedRepo.save(breeds);
      }

      // Return the complete profile with relations
      return profileRepo.findOne({
        where: { id: savedFarmer.id },
        relations: ['user', 'locations', 'contacts', 'breeds'],
      });
    });
  }

  async updateBasicUserDetail(
    dto: UpdateBasicUserDetailDto,
    user: UserEntity,
  ): Promise<UserEntity> {
    const { firstname, lastname, address, username, gender } = dto;

    // Update user details
    if (firstname !== undefined) user.firstname = firstname;
    if (lastname !== undefined) user.lastname = lastname;
    if (address !== undefined) user.address = address;
    if (username !== undefined) user.username = username;
    if (gender !== undefined) user.gender = gender;

    return this.userRepo.save(user);
  }

  async findAll(query: PaginateQuery): Promise<Paginated<UserEntity>> {
    const paginationOptions: PaginateConfig<UserEntity> = {
      sortableColumns: ['id', 'firstname', 'lastname', 'username', 'email'],
      nullSort: 'last',
      searchableColumns: [
        'firstname',
        'lastname',
        'username',
        'email',
        'phone',
        'contactPhone',
      ],
      defaultSortBy: [['createdAt', 'DESC']],
      filterableColumns: {
        firstname: [FilterOperator.ILIKE],
        lastname: [FilterOperator.ILIKE],
        roles: [FilterOperator.EQ],
        position: [FilterOperator.EQ],
        department: [FilterOperator.EQ],
        createdAt: [FilterOperator.GTE, FilterOperator.LTE],
      },
      defaultLimit: 25,
      maxLimit: 500,
    };

    const result = await paginate(query, this.userRepo, paginationOptions);

    // Transform items so @Exclude takes effect
    result.data = plainToInstance(UserEntity, result.data);

    return result;
  }

  async activate(id: string, activate: boolean): Promise<UserEntity> {
    const user = await this.userRepo.findOne({ where: { id } });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    if (user.isVerified === activate) {
      throw new BadRequestException(
        `User is already ${activate ? 'active' : 'inactive'}`,
      );
    }

    user.isVerified = activate;
    return this.userRepo.save(user);
  }

  async findOne(id: string): Promise<UserEntity> {
    const user = await this.userRepo.findOne({ where: { id } });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return plainToInstance(UserEntity, user);
  }

  async findOneForAdmin(id: string) {
    const user = await this.userRepo.findOne({ where: { id } });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    const [orderCount, lastOrder, spent, wallet] = await Promise.all([
      this.dataSource
        .getRepository(OrderEntity)
        .createQueryBuilder('order')
        .where('order.userId = :userId', { userId: id })
        .getCount(),
      this.dataSource
        .getRepository(OrderEntity)
        .createQueryBuilder('order')
        .select('MAX(order.createdAt)', 'lastOrderAt')
        .where('order.userId = :userId', { userId: id })
        .getRawOne<{ lastOrderAt: Date | null }>(),
      this.dataSource
        .getRepository(PaymentEntity)
        .createQueryBuilder('payment')
        .select('COALESCE(SUM(payment.amountPaid), 0)', 'total')
        .where('payment.userId = :userId', { userId: id })
        .andWhere('payment.paymentStatus = :status', {
          status: PaymentStatus.Completed,
        })
        .getRawOne<{ total: string }>(),
      this.dataSource
        .getRepository(WalletEntity)
        .findOne({ where: { userId: id } }),
    ]);

    return {
      ...plainToInstance(UserEntity, user),
      orderCount,
      totalSpent: Number(spent?.total ?? 0),
      lastOrderAt: lastOrder?.lastOrderAt ?? null,
      walletBalance: wallet ? Number(wallet.balance) : null,
    };
  }

  /** Referral data for the admin customer page. */
  async getReferrals(id: string) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    const referrer = user.referredBy
      ? await this.userRepo.findOne({
          where: { id: user.referredBy },
          select: ['id', 'username', 'email'],
        })
      : null;

    const [referred, referredCount] = await this.userRepo.findAndCount({
      where: { referredBy: id },
      order: { createdAt: 'DESC' },
      take: REFERRAL_LIST_LIMIT,
      select: ['id', 'username', 'email', 'createdAt', 'isVerified'],
    });

    const vouchers = await this.dataSource
      .getRepository(VoucherEntity)
      .find({ where: { user: { id }, sourceKey: Like('referral:%') } });

    const now = Date.now();
    const statusOf = (v: VoucherEntity): VoucherStatus =>
      v.status === VoucherStatus.Active &&
      new Date(v.expiresAt).getTime() <= now
        ? VoucherStatus.Expired
        : v.status;
    const byReferral = new Map(
      vouchers.map((v) => [v.sourceKey.slice('referral:'.length), v]),
    );

    const ids = referred.map((r) => r.id);
    const paid = ids.length
      ? await this.dataSource
          .getRepository(PaymentEntity)
          .createQueryBuilder('payment')
          .select('DISTINCT payment.userId', 'userId')
          .where('payment.userId IN (:...ids)', { ids })
          .andWhere('payment.paymentStatus = :status', {
            status: PaymentStatus.Completed,
          })
          .getRawMany<{ userId: string }>()
      : [];
    const paidIds = new Set(paid.map((p) => p.userId));

    const earnings = {
      currency: 'NGN',
      totalEarned: 0,
      redeemed: 0,
      available: 0,
      expired: 0,
      voucherCount: vouchers.length,
    };
    for (const v of vouchers) {
      const amount = Number(v.amount);
      earnings.totalEarned += amount;
      const status = statusOf(v);
      if (status === VoucherStatus.Redeemed) earnings.redeemed += amount;
      else if (status === VoucherStatus.Active) earnings.available += amount;
      else if (status === VoucherStatus.Expired) earnings.expired += amount;
    }

    return {
      referralCode: user.referralCode ?? null,
      referredBy: referrer
        ? {
            id: referrer.id,
            username: referrer.username,
            email: referrer.email,
          }
        : null,
      referredCount,
      referrals: referred.map((r) => {
        const voucher = byReferral.get(r.id);
        return {
          id: r.id,
          username: r.username,
          email: r.email,
          joinedAt: r.createdAt,
          isVerified: r.isVerified,
          hasPaidOrder: paidIds.has(r.id),
          rewardAmount: voucher ? Number(voucher.amount) : null,
          rewardStatus: voucher ? statusOf(voucher) : null,
        };
      }),
      earnings,
    };
  }

  async findByEmailOrPhone(emailOrPhone: string): Promise<UserEntity> {
    return this.userRepo.findOne({
      where: [
        {
          email: emailOrPhone.includes('@')
            ? emailOrPhone.trim().toLowerCase()
            : emailOrPhone,
        },
        { phone: emailOrPhone },
      ],
    });
  }

  async remove(id: string, actor: UserRemovalActor): Promise<void> {
    if (this.isAdminActor(actor)) {
      this.assertAdminCanDeleteUsers(actor);
    } else if (actor.id !== id) {
      throw new UnauthorizedException('You can only delete your own account');
    }

    const user = await this.userRepo.findOneBy({ id });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    await this.userRepo.softDelete(id);
  }

  private isAdminActor(actor: UserRemovalActor): actor is AdminEntity {
    return (
      (actor as AdminEntity & { principalType?: string }).principalType ===
      'admin'
    );
  }

  private assertAdminCanDeleteUsers(actor: AdminEntity): void {
    if (actor.userType !== UserTypes.System || !actor.isVerified) {
      throw new UnauthorizedException(
        'You are not authorized to call this API',
      );
    }

    const roles = actor.roles || [];
    const isSuperAdmin = roles.some((role) => role.name === Role.SuperAdmin);
    if (isSuperAdmin) return;

    const canDeleteUsers = roles
      .flatMap((role) => role.permissions || [])
      .some((permission) => {
        if (permission.resource !== RESOURCES.USERS) return false;
        return permission.actions.some(
          (action) => action === ACTIONS.DELETE || action === ACTIONS.MANAGE,
        );
      });

    if (!canDeleteUsers) {
      throw new ForbiddenException('Access Denied: Insufficient permissions');
    }
  }

  async updateProfile(
    id: string,
    updateLivestockFarmerDto: UpdateLivestockFarmerDto,
  ) {
    const {
      user,
      breeds = [],
      locations = [],
      contacts = [],
      ...profileData
    } = updateLivestockFarmerDto;
    return this.dataSource.transaction(async (transactionalEntityManager) => {
      const profileRepository = transactionalEntityManager.getRepository(
        LivestockFarmerProfile,
      );
      const breedRepository =
        transactionalEntityManager.getRepository(LivestockBreed);
      const locationRepository =
        transactionalEntityManager.getRepository(FarmLocation);
      const contactRepository =
        transactionalEntityManager.getRepository(ContactInformation);

      // Find profile with all relations
      const profile = await profileRepository.findOne({
        where: { id },
        relations: ['user', 'breeds', 'locations', 'contacts'],
      });

      if (!profile) {
        throw new NotFoundException(`Profile with ID ${id} not found`);
      }

      // Authorization check
      if (profile.user.id !== user.id) {
        throw new UnauthorizedException(
          'You are not authorized to update this profile',
        );
      }

      // Update main profile fields
      profileRepository.merge(profile, profileData);

      // Handle breeds
      if (breeds) {
        profile.breeds = await this.handleBreeds(
          profile,
          breeds,
          breedRepository,
        );
      }

      // Handle locations
      if (locations) {
        profile.locations = await this.handleLocations(
          profile,
          locations,
          locationRepository,
        );
      }

      // Handle contacts
      if (contacts) {
        profile.contacts = await this.handleContacts(
          profile,
          contacts,
          contactRepository,
        );
      }

      // Save the profile with all relations
      return profileRepository.save(profile);
    });
  }

  private async handleBreeds(
    profile: LivestockFarmerProfile,
    breedDtos: BreedDto[],
    breedRepo: Repository<LivestockBreed>,
  ) {
    // Get existing breed types
    const existingBreedTypes =
      profile.breeds?.map((b) => b.livestockType) || [];

    // Get incoming breed types
    const incomingBreedTypes = breedDtos.map((b) => b.livestockType);

    // Determine breeds to remove (existing but not in incoming)
    const breedsToRemove = existingBreedTypes.filter(
      (type) => !incomingBreedTypes.includes(type),
    );

    // Remove obsolete breeds
    if (breedsToRemove.length > 0) {
      await breedRepo.delete({
        farmerProfile: { id: profile.id },
        livestockType: In(breedsToRemove),
      });
    }

    return Promise.all(
      breedDtos.map(async (dto) => {
        let breed = profile.breeds?.find(
          (b) => b.livestockType === dto.livestockType,
        );

        if (breed) {
          // Update existing breed
          breedRepo.merge(breed, dto);
        } else {
          // Create new breed
          breed = breedRepo.create({
            ...dto,
            farmerProfile: profile,
          });
        }

        return breed;
      }),
    );
  }

  private async handleLocations(
    profile: LivestockFarmerProfile,
    locationDtos: LocationDto[],
    locationRepo: Repository<FarmLocation>,
  ) {
    // Clear existing locations if replacing all
    await locationRepo.delete({ farmerProfile: { id: profile.id } });

    return Promise.all(
      locationDtos.map((dto) => {
        const location = locationRepo.create({
          ...dto,
          farmerProfile: profile,
        });
        return locationRepo.save(location);
      }),
    );
  }

  private async handleContacts(
    profile: LivestockFarmerProfile,
    contactDtos: ContactDto[],
    contactRepo: Repository<ContactInformation>,
  ) {
    // Handle primary contact logic
    const hasPrimary = contactDtos.some((c) => c.isPrimary);
    const normalizedDtos = contactDtos.map((dto) => ({
      ...dto,
      isPrimary: hasPrimary ? dto.isPrimary : false,
    }));

    // Clear existing contacts (or implement more sophisticated logic if needed)
    await contactRepo.delete({ farmerProfile: { id: profile.id } });

    // Create all new contacts
    return Promise.all(
      normalizedDtos.map((dto) => {
        const contact = contactRepo.create({
          ...dto,
          farmerProfile: profile,
        });
        return contact;
      }),
    );
  }
}
