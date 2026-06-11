import { Entity, Column, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Role } from './role.entity';
import { Doctype } from './doctype.entity';

@Entity({ name: 'permissions' })
@Unique(['role', 'doctype'])
export class Permission extends BaseEntity {
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
