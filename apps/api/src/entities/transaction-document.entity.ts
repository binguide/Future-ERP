import { Entity, Column } from 'typeorm';
import { TransactionBase } from './transaction-base.entity';

@Entity({ name: 'transaction_docs' })
export class TransactionDocument extends TransactionBase {
  @Column({ name: 'company_id' })
  companyId: string;

  @Column({ length: 255 })
  title: string;

  @Column({ name: 'posting_date', type: 'date' })
  postingDate: Date;
}
