import { Entity, Column, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Workflow } from './workflow.entity';
import { WorkflowState } from './workflow-state.entity';
import { Role } from './role.entity';

@Entity({ name: 'workflow_transitions' })
@Unique(['workflow', 'fromState', 'toState', 'role'])
export class WorkflowTransition extends BaseEntity {
  @ManyToOne(() => Workflow)
  @JoinColumn({ name: 'workflow_id' })
  workflow: Workflow;

  @Column({ name: 'workflow_id' })
  workflowId: string;

  @ManyToOne(() => WorkflowState)
  @JoinColumn({ name: 'from_state_id' })
  fromState: WorkflowState;

  @Column({ name: 'from_state_id' })
  fromStateId: string;

  @ManyToOne(() => WorkflowState)
  @JoinColumn({ name: 'to_state_id' })
  toState: WorkflowState;

  @Column({ name: 'to_state_id' })
  toStateId: string;

  @ManyToOne(() => Role)
  @JoinColumn({ name: 'role_id' })
  role: Role;

  @Column({ name: 'role_id' })
  roleId: string;

  @Column({ type: 'text', nullable: true })
  condition: string;

  @Column({ length: 20, default: 'Approve' })
  action: string;

  @Column({ default: 0 })
  sequence: number;
}
