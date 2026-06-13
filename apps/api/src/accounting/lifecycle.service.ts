import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { tenantStorage, assertSafeSchemaName } from '../tenant/tenant-context';
import { PostingService, PostingInput } from './posting.service';
import { TransactionBase } from '../entities/transaction-base.entity';
import { GLEntry } from '../entities/gl-entry.entity';
import { WorkflowEngineService } from '../workflow/workflow-engine.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class LifecycleService {
  constructor(
    private readonly postingService: PostingService,
    private readonly dataSource: DataSource,
    private readonly workflowEngine: WorkflowEngineService,
    private readonly auditService: AuditService,
  ) {}

  async submit<T extends TransactionBase>(
    doc: T,
    repo: Repository<T>,
    postingInput: PostingInput,
    actorId: string,
  ): Promise<GLEntry[]> {
    const store = tenantStorage.getStore();
    if (!store) throw new Error('LifecycleService requires a tenant context');
    const schema = assertSafeSchemaName(store.schemaName);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.query(`SET search_path TO "${schema}", public`);
    await queryRunner.startTransaction();

    try {
      const manager = queryRunner.manager;

      // Re-read doc with pessimistic lock
      const lockedDoc = await manager.getRepository<T>(repo.target).findOneOrFail({
        where: { id: doc.id } as any,
        lock: { mode: 'pessimistic_write' },
      });
      if ((lockedDoc as any).docstatus !== 0) {
        throw new Error('Only draft documents can be submitted');
      }

      const check = await this.workflowEngine.canSubmit(
        postingInput.referenceDoctype,
        lockedDoc as TransactionBase,
        postingInput.lines?.reduce((sum, l) => sum + (l.debit || 0), 0),
      );
      if (!check.allowed) {
        throw new Error(check.reason);
      }

      const entries = await this.postingService.post(postingInput, manager);

      (lockedDoc as any).docstatus = 1;
      (lockedDoc as any).submittedAt = new Date();
      (lockedDoc as any).submittedBy = actorId;
      await manager.getRepository<T>(repo.target as any).save(lockedDoc as any);

      await queryRunner.commitTransaction();

      // Update the caller's references
      Object.assign(doc, lockedDoc);

      // Log activity (non-critical — errors are swallowed)
      this.logActivityAsync(postingInput.referenceDoctype, postingInput.referenceDocId, 'Submit', 'Document submitted', actorId);

      return entries;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  async cancel<T extends TransactionBase>(
    doc: T,
    repo: Repository<T>,
    postingInput: PostingInput,
    actorId: string,
  ): Promise<GLEntry[]> {
    const store = tenantStorage.getStore();
    if (!store) throw new Error('LifecycleService requires a tenant context');
    const schema = assertSafeSchemaName(store.schemaName);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.query(`SET search_path TO "${schema}", public`);
    await queryRunner.startTransaction();

    try {
      const manager = queryRunner.manager;

      // Re-read doc with pessimistic lock
      const lockedDoc = await manager.getRepository<T>(repo.target).findOneOrFail({
        where: { id: doc.id } as any,
        lock: { mode: 'pessimistic_write' },
      });
      if ((lockedDoc as any).docstatus !== 1) {
        throw new Error('Only submitted documents can be cancelled');
      }

      const originals = await manager.getRepository(GLEntry).find({
        where: {
          referenceDoctype: postingInput.referenceDoctype,
          referenceDocId: postingInput.referenceDocId,
          isReversal: false,
        },
      });

      if (!originals.length) throw new Error('No GLEntries found for this document');

      const reversals = await this.postingService.cancel(originals, postingInput, manager);

      (lockedDoc as any).docstatus = 2;
      (lockedDoc as any).cancelledAt = new Date();
      (lockedDoc as any).cancelledBy = actorId;
      await manager.getRepository<T>(repo.target as any).save(lockedDoc as any);

      await queryRunner.commitTransaction();

      Object.assign(doc, lockedDoc);

      this.logActivityAsync(postingInput.referenceDoctype, postingInput.referenceDocId, 'Cancel', 'Document cancelled', actorId);

      return reversals;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  private async logActivityAsync(
    referenceDoctype: string,
    referenceDocId: string,
    activityType: string,
    message: string,
    actorId: string,
  ): Promise<void> {
    try {
      const doctype = await this.auditService.resolveDoctypeByName(referenceDoctype);
      if (doctype) {
        await this.auditService.logActivity(doctype.id, referenceDocId, activityType, message);
      }
    } catch {
      // Audit logging is non-critical; swallow errors
    }
  }
}
