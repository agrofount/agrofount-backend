import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum LedgerDirection {
  Debit = 'debit',
  Credit = 'credit',
}

@Entity('ledger_entry')
@Index('UQ_ledger_operation_line', ['operationKey', 'lineNumber'], {
  unique: true,
})
@Index('IDX_ledger_account_created', ['accountType', 'accountId', 'createdAt'])
@Index('IDX_ledger_reference', ['referenceType', 'referenceId'])
export class LedgerEntryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 160 })
  operationKey: string;

  @Column({ type: 'smallint' })
  lineNumber: number;

  @Column({ length: 40 })
  accountType: string;

  @Column({ length: 100 })
  accountId: string;

  @Column({ type: 'enum', enum: LedgerDirection })
  direction: LedgerDirection;

  @Column({ type: 'bigint' })
  amountMinor: string;

  @Column({ length: 3, default: 'NGN' })
  currency: string;

  @Column({ nullable: true, length: 32 })
  referenceType: string | null;

  @Column({ nullable: true, length: 100 })
  referenceId: string | null;

  @Column({ type: 'uuid', nullable: true })
  walletTransactionId: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
