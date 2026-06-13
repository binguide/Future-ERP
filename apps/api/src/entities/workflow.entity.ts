import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Doctype } from './doctype.entity';

@Entity({ name: 'workflows' })
@Index(['doctypeId', 'isActive'])
export class Workflow extends BaseEntity {
  @ManyToOne(() => Doctype)
  @JoinColumn({ name: 'doctype_id' })
  doctype: Doctype;

  @Column({ name: 'doctype_id' })
  doctypeId: string;

  @Column({ name: 'workflow_name', length: 255 })
  workflowName: string;

  @Column({ name: 'is_active', default: false })
  isActive: boolean;

  @Column({ type: 'text', nullable: true })
  condition: string;
}
