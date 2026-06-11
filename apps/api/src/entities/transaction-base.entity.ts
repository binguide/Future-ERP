import { Column } from 'typeorm';
import { BaseEntity } from './base.entity';

export abstract class TransactionBase extends BaseEntity {
  @Column({ type: 'smallint', default: 0 })
  docstatus: number;

  @Column({ type: 'timestamptz', name: 'submitted_at', nullable: true })
  submittedAt: Date | null;

  @Column({ type: 'uuid', name: 'submitted_by', nullable: true })
  submittedBy: string | null;

  @Column({ type: 'timestamptz', name: 'cancelled_at', nullable: true })
  cancelledAt: Date | null;

  @Column({ type: 'uuid', name: 'cancelled_by', nullable: true })
  cancelledBy: string | null;
}
