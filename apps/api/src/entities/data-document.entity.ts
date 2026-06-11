import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Doctype } from './doctype.entity';

@Entity({ name: 'data_documents' })
@Index(['doctype'])
export class DataDocument extends BaseEntity {
  @ManyToOne(() => Doctype)
  @JoinColumn({ name: 'doctype_id' })
  doctype: Doctype;

  @Column({ type: 'jsonb' })
  data: Record<string, unknown>;
}
