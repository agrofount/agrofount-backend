import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import {
  FilterOperator,
  paginate,
  Paginated,
  PaginateQuery,
} from 'nestjs-paginate';
import {
  ComplaintEntity,
  UNRESOLVED_COMPLAINT_STATUSES,
} from './entities/complaint.entity';
import { UserEntity } from '../user/entities/user.entity';
import { OrderEntity } from '../order/entities/order.entity';
import { AdminEntity } from '../admins/entities/admin.entity';
import { CreateComplaintDto } from './dto/create-complaint.dto';
import { UpdateComplaintDto } from './dto/update-complaint.dto';

const RESOLVING_STATUSES = ['resolved', 'closed'];

@Injectable()
export class ComplaintsService {
  private readonly logger = new Logger(ComplaintsService.name);

  constructor(
    @InjectRepository(ComplaintEntity)
    private complaintRepo: Repository<ComplaintEntity>,
  ) {}

  async create(
    user: UserEntity,
    dto: CreateComplaintDto,
  ): Promise<ComplaintEntity> {
    let order: OrderEntity | null = null;
    if (dto.orderId) {
      order = await this.complaintRepo.manager
        .getRepository(OrderEntity)
        .findOne({ where: { id: dto.orderId, user: { id: user.id } } });
      if (!order) throw new NotFoundException('Order not found');
    }

    const complaint = this.complaintRepo.create({
      user,
      order,
      subject: dto.subject.trim(),
      description: dto.description.trim(),
    });
    return this.complaintRepo.save(complaint);
  }

  async findAllForUser(
    query: PaginateQuery,
    user: UserEntity,
  ): Promise<Paginated<ComplaintEntity>> {
    return paginate(query, this.complaintRepo, {
      sortableColumns: ['id', 'status', 'priority', 'createdAt'],
      defaultSortBy: [['createdAt', 'DESC']],
      filterableColumns: { status: [FilterOperator.EQ] },
      where: { user: { id: user.id } },
      defaultLimit: 25,
      maxLimit: 100,
    });
  }

  async findOneForUser(id: string, user: UserEntity): Promise<ComplaintEntity> {
    const complaint = await this.complaintRepo.findOne({
      where: { id, user: { id: user.id } },
      relations: ['order'],
    });
    if (!complaint) throw new NotFoundException('Complaint not found');
    return plainToInstance(ComplaintEntity, complaint);
  }

  async findAllForAdmin(
    query: PaginateQuery,
  ): Promise<Paginated<ComplaintEntity>> {
    return paginate(query, this.complaintRepo, {
      sortableColumns: ['id', 'status', 'priority', 'createdAt', 'resolvedAt'],
      searchableColumns: ['subject'],
      defaultSortBy: [['createdAt', 'DESC']],
      filterableColumns: {
        status: [FilterOperator.EQ],
        priority: [FilterOperator.EQ],
        'user.id': [FilterOperator.EQ],
        'assignedAdmin.id': [FilterOperator.EQ],
      },
      relations: ['user', 'assignedAdmin'],
      defaultLimit: 25,
      maxLimit: 100,
    });
  }

  async findOneForAdmin(id: string): Promise<ComplaintEntity> {
    const complaint = await this.complaintRepo.findOne({
      where: { id },
      relations: ['user', 'order', 'assignedAdmin'],
    });
    if (!complaint) throw new NotFoundException('Complaint not found');
    return plainToInstance(ComplaintEntity, complaint);
  }

  async updateForAdmin(
    id: string,
    dto: UpdateComplaintDto,
  ): Promise<ComplaintEntity> {
    const complaint = await this.complaintRepo.findOne({ where: { id } });
    if (!complaint) throw new NotFoundException('Complaint not found');

    if (dto.assignedAdminId !== undefined) {
      const admin = await this.complaintRepo.manager
        .getRepository(AdminEntity)
        .findOne({ where: { id: dto.assignedAdminId } });
      if (!admin) throw new NotFoundException('Admin not found');
      complaint.assignedAdmin = admin;
    }
    if (dto.priority !== undefined) complaint.priority = dto.priority;
    if (dto.resolutionNotes !== undefined)
      complaint.resolutionNotes = dto.resolutionNotes.trim();
    if (dto.status !== undefined) {
      complaint.status = dto.status;
      complaint.resolvedAt = RESOLVING_STATUSES.includes(dto.status)
        ? complaint.resolvedAt ?? new Date()
        : null;
    }

    return this.complaintRepo.save(complaint);
  }

  async hasUnresolvedComplaint(userId: string): Promise<boolean> {
    const count = await this.complaintRepo.count({
      where: {
        user: { id: userId },
        status: In(UNRESOLVED_COMPLAINT_STATUSES),
      },
    });
    return count > 0;
  }
}
