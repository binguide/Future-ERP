import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Account } from './account.entity';

@Entity({ name: 'gl_entries' })
@Index(['referenceDoctype', 'referenceDocId'])
@Index(['companyId', 'postingDate'])
export class GLEntry extends BaseEntity {
  @Column({ name: 'company_id' })
  companyId: string;

  @Column({ name: 'account_id' })
  accountId: string;

  @ManyToOne(() => Account)
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  debit: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  credit: number;

  @Column({ length: 3 })
  currency: string;

  @Column({ type: 'decimal', precision: 18, scale: 6, name: 'exchange_rate', default: 1 })
  exchangeRate: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, name: 'base_debit', default: 0 })
  baseDebit: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, name: 'base_credit', default: 0 })
  baseCredit: number;

  @Column({ type: 'date', name: 'posting_date' })
  postingDate: Date;

  @Column({ type: 'varchar', length: 255, name: 'reference_doctype' })
  referenceDoctype: string;

  @Column({ type: 'varchar', name: 'reference_doc_id' })
  referenceDocId: string;

  @Column({ type: 'varchar', name: 'cost_center_id', nullable: true })
  costCenterId: string | null;

  @Column({ type: 'varchar', name: 'branch_id', nullable: true })
  branchId: string | null;

  @Column({ type: 'varchar', nullable: true })
  description: string | null;
}
