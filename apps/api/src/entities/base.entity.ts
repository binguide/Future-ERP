import {
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Column,
} from 'typeorm';

/**
 * Shared columns for every entity: a uuid primary key, system timestamps
 * (`created_at` / `updated_at`), and audit stamps (`created_by` / `modified_by`).
 * Concrete entities extend this and add their own columns.
 * Abstract — not mapped to a table of its own.
 */
export abstract class BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @Column({ name: 'modified_by', type: 'uuid', nullable: true })
  modifiedBy: string | null;
}
