import { Entity, Column } from 'typeorm';
import { BaseEntity } from './base.entity';

@Entity({ schema: 'public', name: 'tenants' })
export class Tenant extends BaseEntity {
  @Column({ length: 255 })
  name: string;

  @Column({ length: 255, unique: true })
  domain: string;

  @Column({ name: 'schema_name', length: 63, unique: true })
  schemaName: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;
}
