import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Doctype } from './doctype.entity';

@Entity({ name: 'docfields' })
export class DocField extends BaseEntity {
  @Column({ length: 255 })
  fieldname: string;

  @Column({ length: 255 })
  label: string;

  @Column({ length: 255 })
  fieldtype: string;

  @Column({ length: 255, nullable: true })
  options: string;

  @Column({ default: 0 })
  idx: number;

  @Column({ name: 'is_mandatory', default: false })
  isMandatory: boolean;

  @Column({ name: 'is_read_only', default: false })
  isReadOnly: boolean;

  @Column({ name: 'is_unique', default: false })
  isUnique: boolean;

  @Column({ name: 'default_value', length: 255, nullable: true })
  defaultValue: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @ManyToOne(() => Doctype, (d) => d.fields)
  @JoinColumn({ name: 'doctype_id' })
  doctype: Doctype;
}
