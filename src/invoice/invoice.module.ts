import { Module } from '@nestjs/common';
import { InvoiceService } from './invoice.service';
import { InvoiceController } from './invoice.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvoiceEntity } from './entities/invoice.entity';

@Module({
  imports: [TypeOrmModule.forFeature([InvoiceEntity])],
  controllers: [InvoiceController],
  providers: [InvoiceService],
})
export class InvoiceModule {}
