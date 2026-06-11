import { Entity, Column } from 'typeorm';
import { BaseEntity } from './base.entity';

@Entity({ name: 'currencies' })
export class Currency extends BaseEntity {
  @Column({ length: 3, unique: true })
  code: string;

  @Column({ length: 255 })
  name: string;

  @Column({ length: 10, nullable: true })
  symbol: string;
}