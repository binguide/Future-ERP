import { Entity, Column, ManyToOne, JoinColumn, Index, BeforeUpdate } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Doctype } from './doctype.entity';

export type ActivityType = 'Create' | 'Update' | 'Submit' | 'Cancel' | 'Comment' | 'Approve' | 'Reject';

@Entity({ name: 'activity_logs' })
@Index(['doctypeId', 'referenceDocId'])
export class ActivityLog extends BaseEntity {
  @ManyToOne(() => Doctype)
  @JoinColumn({ name: 'doctype_id' })
  doctype: Doctype;

  @Column({ name: 'doctype_id' })
  doctypeId: string;

  @Column({ name: 'reference_doc_id', type: 'uuid' })
  referenceDocId: string;

  @Column({ name: 'activity_type', length: 50 })
  activityType: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ type: 'text', nullable: true })
  message: string;

  @Column({ name: 'old_value', type: 'jsonb', nullable: true })
  oldValue: Record<string, unknown> | null;

  @Column({ name: 'new_value', type: 'jsonb', nullable: true })
  newValue: Record<string, unknown> | null;

  @BeforeUpdate()
  preventUpdate(): void {
    throw new Error('activity_logs is append-only');
  }
}
