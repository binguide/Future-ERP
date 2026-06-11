import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Tenant } from './tenant.entity';

export enum TenantUserRole {
  ADMIN = 'admin',
  USER = 'user',
  READONLY = 'readonly',
}

@Entity({ schema: 'public', name: 'tenant_users' })
export class TenantUser extends BaseEntity {
  @Column({ name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ length: 255, unique: true })
  email: string;

  @Column({ length: 255 })
  name: string;

  @Column({ name: 'password_hash', length: 255 })
  passwordHash: string;

  @Column({
    type: 'enum',
    enum: TenantUserRole,
    default: TenantUserRole.USER,
  })
  role: TenantUserRole;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;
}
