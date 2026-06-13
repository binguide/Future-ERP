import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Doctype } from './doctype.entity';

@Entity({ name: 'workflow_actions' })
@Index(['doctype', 'referenceDocId'])
export class WorkflowAction extends BaseEntity {
  @ManyToOne(() => Doctype)
  @JoinColumn({ name: 'doctype_id' })
  doctype: Doctype;

  @Column({ name: 'doctype_id' })
  doctypeId: string;

  @Column({ name: 'reference_doc_id', type: 'uuid' })
  referenceDocId: string;

  @Column({ name: 'from_state_id', type: 'uuid', nullable: true })
  fromStateId: string;

  @Column({ name: 'to_state_id', type: 'uuid' })
  toStateId: string;

  @Column({ length: 20 })
  action: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'text' })
  comment: string;
}
