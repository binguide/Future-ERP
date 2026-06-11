import { Entity, Column, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Role } from './role.entity';
import { Doctype } from './doctype.entity';

@Entity({ name: 'approval_authorities' })
@Unique(['role', 'doctype'])
export class ApprovalAuthority extends BaseEntity {
  @ManyToOne(() => Role)
  @JoinColumn({ name: 'role_id' })
  role: Role;

  @Column({ name: 'role_id' })
  roleId: string;

  @ManyToOne(() => Doctype)
  @JoinColumn({ name: 'doctype_id' })
  doctype: Doctype;

  @Column({ name: 'doctype_id' })
  doctypeId: string;

  @Column({ name: 'value_ceiling', type: 'decimal', precision: 18, scale: 2, nullable: true })
  valueCeiling: number | null;

  @Column({ name: 'can_approve', default: false })
  canApprove: boolean;
}
