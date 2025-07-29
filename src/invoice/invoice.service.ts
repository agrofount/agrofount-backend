import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { plainToInstance } from 'class-transformer';
import { InvoiceEntity } from './entities/invoice.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { OrderEntity } from 'src/order/entities/order.entity';
import { Repository } from 'typeorm';
import {
  FilterOperator,
  paginate,
  Paginated,
  PaginateQuery,
} from 'nestjs-paginate';
import { UserEntity } from 'src/user/entities/user.entity';
import { AdminEntity } from 'src/admins/entities/admin.entity';
import { UserTypes } from 'src/auth/enums/role.enum';

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

  async findByOrderId(orderId: string) {
    try {
      const invoice = await this.invoiceRepo.findOne({
        where: { order: { id: orderId } },
        relations: ['order'],
      });

      if (!invoice) {
        throw new NotFoundException(
          `Invoice for order with ID ${orderId} not found`,
        );
      }

      return plainToInstance(InvoiceEntity, invoice);
    } catch (error) {
      console.error('Error finding invoice by order ID:', error);
      throw error; // Rethrow the error to propagate it
    }
  }
}
