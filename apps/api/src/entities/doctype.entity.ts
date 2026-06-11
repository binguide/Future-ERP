import { Entity, Column, OneToMany } from 'typeorm';
import { BaseEntity } from './base.entity';
import { DocField } from './docfield.entity';

@Entity({ name: 'doctypes' })
export class Doctype extends BaseEntity {
  @Column({ length: 255, unique: true })
  name: string;

  @Column({ length: 255 })
  label: string;

  @Column({ length: 255, nullable: true })
  module: string;

  @Column({ name: 'is_child', default: false })
  isChild: boolean;

  @Column({ name: 'is_single', default: false })
  isSingle: boolean;

  @Column({ name: 'is_submittable', default: false })
  isSubmittable: boolean;

  @Column({ length: 20, default: 'None' })
  tracking: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @OneToMany(() => DocField, (df) => df.doctype)
  fields: DocField[];
}
