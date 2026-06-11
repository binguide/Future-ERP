import { Entity, Column, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { BaseEntity } from './base.entity';
import { User } from './user.entity';
import { Doctype } from './doctype.entity';

@Entity({ name: 'user_permissions' })
@Unique(['user', 'doctype', 'companyId', 'branchId', 'warehouseId'])
export class UserPermission extends BaseEntity {
  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => Doctype)
  @JoinColumn({ name: 'doctype_id' })
  doctype: Doctype;

  @Column({ name: 'doctype_id' })
  doctypeId: string;

  @Column({ name: 'company_id', type: 'varchar', nullable: true })
  companyId: string | null;

  @Column({ name: 'branch_id', type: 'varchar', nullable: true })
  branchId: string | null;

  @Column({ name: 'warehouse_id', type: 'varchar', nullable: true })
  warehouseId: string | null;

  @Column({ default: false })
  create: boolean;

  @Column({ default: false })
  read: boolean;

  @Column({ default: false })
  update: boolean;

  @Column({ default: false })
  delete: boolean;

  @Column({ default: false })
  submit: boolean;

  @Column({ default: false })
  cancel: boolean;

  @Column({ default: false })
  approve: boolean;

  @Column({ default: false })
  reject: boolean;
}
