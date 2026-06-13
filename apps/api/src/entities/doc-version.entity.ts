import { Entity, Column, ManyToOne, JoinColumn, Index, Unique, BeforeUpdate } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Doctype } from './doctype.entity';

@Entity({ name: 'doc_versions' })
@Index(['doctypeId', 'referenceDocId'])
@Unique(['doctypeId', 'referenceDocId', 'versionNumber'])
export class DocVersion extends BaseEntity {
  @ManyToOne(() => Doctype)
  @JoinColumn({ name: 'doctype_id' })
  doctype: Doctype;

  @Column({ name: 'doctype_id' })
  doctypeId: string;

  @Column({ name: 'reference_doc_id', type: 'uuid' })
  referenceDocId: string;

  @Column({ name: 'old_data', type: 'jsonb', nullable: true })
  oldData: Record<string, unknown> | null;

  @Column({ name: 'new_data', type: 'jsonb' })
  newData: Record<string, unknown>;

  @Column({ name: 'version_number', type: 'integer', default: 1 })
  versionNumber: number;

  @BeforeUpdate()
  preventUpdate(): void {
    throw new Error('doc_versions is append-only');
  }
}
