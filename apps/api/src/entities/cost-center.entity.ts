import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Company } from './company.entity';

@Entity({ name: 'cost_centers' })
export class CostCenter extends BaseEntity {
  @Column({ length: 255 })
  name: string;

  @Column({ type: 'varchar', name: 'company_id', nullable: true })
  companyId: string | null;

  @ManyToOne(() => Company, { nullable: true })
  @JoinColumn({ name: 'company_id' })
  company: Company | null;
}