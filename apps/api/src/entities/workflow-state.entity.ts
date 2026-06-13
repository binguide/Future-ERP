import { Entity, Column, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Workflow } from './workflow.entity';

@Entity({ name: 'workflow_states' })
@Unique(['workflow', 'stateName'])
export class WorkflowState extends BaseEntity {
  @ManyToOne(() => Workflow)
  @JoinColumn({ name: 'workflow_id' })
  workflow: Workflow;

  @Column({ name: 'workflow_id' })
  workflowId: string;

  @Column({ name: 'state_name', length: 255 })
  stateName: string;

  @Column({ type: 'smallint', default: 0 })
  docstatus: number;

  @Column({ name: 'is_editable', default: true })
  isEditable: boolean;

  @Column({ name: 'is_terminal', default: false })
  isTerminal: boolean;
}
