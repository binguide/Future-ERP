import { Entity, Column, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Company } from './company.entity';

export enum AccountType {
  ASSET = 'Asset',
  LIABILITY = 'Liability',
  EQUITY = 'Equity',
  INCOME = 'Income',
  EXPENSE = 'Expense',
}

@Entity({ name: 'accounts' })
@Unique(['companyId', 'accountNumber'])
export class Account extends BaseEntity {
  @Column({ length: 255 })
  name: string;

  @Column({ type: 'varchar', name: 'account_number', length: 50, nullable: true })
  accountNumber: string | null;

  @Column({
    type: 'enum',
    enum: AccountType,
  })
  type: AccountType;

  @Column({ name: 'is_group', default: false })
  isGroup: boolean;

  @Column({ name: 'company_id' })
  companyId: string;

  @ManyToOne(() => Company)
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @Column({ name: 'parent_id', nullable: true })
  parentId: string | null;

  @ManyToOne(() => Account, { nullable: true })
  @JoinColumn({ name: 'parent_id' })
  parent: Account | null;
}