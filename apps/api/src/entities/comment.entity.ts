import { Entity, Column, ManyToOne, JoinColumn, Index, BeforeUpdate } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Doctype } from './doctype.entity';

@Entity({ name: 'comments' })
@Index(['doctypeId', 'referenceDocId'])
export class Comment extends BaseEntity {
  @ManyToOne(() => Doctype)
  @JoinColumn({ name: 'doctype_id' })
  doctype: Doctype;

  @Column({ name: 'doctype_id' })
  doctypeId: string;

  @Column({ name: 'reference_doc_id', type: 'uuid' })
  referenceDocId: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ type: 'text' })
  content: string;

  @BeforeUpdate()
  preventUpdate(): void {
    throw new Error('comments is append-only');
  }
}
