import { Entity, Column } from 'typeorm';
import { BaseEntity } from './base.entity';

@Entity({ name: 'companies' })
export class Company extends BaseEntity {
  @Column({ length: 255, unique: true })
  name: string;

  @Column({ name: 'base_currency', length: 3 })
  baseCurrency: string;

  @Column({ name: 'default_valuation_method', length: 50, default: 'Moving Average' })
  defaultValuationMethod: string;

  @Column({ name: 'allow_negative_stock', default: false })
  allowNegativeStock: boolean;
}