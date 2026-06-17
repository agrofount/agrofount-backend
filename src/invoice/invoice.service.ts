import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { InvoiceEntity } from './entities/invoice.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  FilterOperator,
  paginate,
  Paginated,
  PaginateQuery,
} from 'nestjs-paginate';
import { UserEntity } from '../user/entities/user.entity';
import { AdminEntity } from '../admins/entities/admin.entity';
import { UserTypes } from '../auth/enums/role.enum';

@Injectable()
export class InvoiceService {
  constructor(
    @InjectRepository(InvoiceEntity)
    private readonly invoiceRepo: Repository<InvoiceEntity>,
  ) {}

  async findAll(
    query: PaginateQuery,
    user: UserEntity | AdminEntity,
  ): Promise<Paginated<InvoiceEntity>> {
    try {
      const result = await paginate(query, this.invoiceRepo, {
        sortableColumns: [
          'id',
          'status',
          'invoiceNumber',
          'totalAmount',
          'createdAt',
        ],
        nullSort: 'last',
        searchableColumns: ['status'],
        defaultSortBy: [['createdAt', 'DESC']],
        filterableColumns: {
          status: [FilterOperator.EQ],
          totalAmount: [FilterOperator.GTE, FilterOperator.LTE],
          createdAt: [FilterOperator.GTE, FilterOperator.LTE],
        },
        where:
          user.userType === UserTypes.System
            ? undefined
            : { order: { user: { id: user.id } } },
        relations: ['order', 'order.user'],
        defaultLimit: 25,
        maxLimit: 100,
        select: [
          'id',
          'status',
          'invoiceNumber',
          'totalAmount',
          'customerName',
          'customerEmail',
          'createdAt',
          'order.id',
          'order.items',
          'order.totalPrice',
          'order.user.id',
          'order.user.username',
        ],
      });

      // Transform the data array so @Exclude takes effect
      result.data = plainToInstance(InvoiceEntity, result.data);

      return result;
    } catch (error) {
      throw new Error(`Failed to fetch invoices: ${error.message}`);
    }
  }

  async findByOrderId(orderId: string, user: UserEntity | AdminEntity) {
    try {
      const invoice = await this.invoiceRepo.findOne({
        where: { order: { id: orderId } },
        relations: ['order', 'order.user'],
      });

      if (!invoice) {
        throw new NotFoundException(
          `Invoice for order with ID ${orderId} not found`,
        );
      }

      if (
        user.userType !== UserTypes.System &&
        invoice.order.user.id !== user.id
      ) {
        throw new ForbiddenException(
          'You are not authorized to view this invoice',
        );
      }

      return plainToInstance(InvoiceEntity, invoice);
    } catch (error) {
      console.error('Error finding invoice by order ID:', error);
      throw error; // Rethrow the error to propagate it
    }
  }
}
