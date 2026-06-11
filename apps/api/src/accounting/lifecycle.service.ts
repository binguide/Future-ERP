import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { TenantContextService } from '../tenant/tenant-context.service';
import { PostingService, PostingInput } from './posting.service';
import { TransactionBase } from '../entities/transaction-base.entity';
import { GLEntry } from '../entities/gl-entry.entity';

@Injectable()
export class LifecycleService {
  constructor(
    private readonly postingService: PostingService,
    private readonly ctx: TenantContextService,
  ) {}

  async submit<T extends TransactionBase>(
    doc: T,
    repo: Repository<T>,
    postingInput: PostingInput,
  ): Promise<GLEntry[]> {
    if (doc.docstatus !== 0) throw new Error('Only draft documents can be submitted');

    const entries = await this.postingService.post(postingInput);

    doc.docstatus = 1;
    doc.submittedAt = new Date();
    await repo.save(doc);

    return entries;
  }

  async cancel<T extends TransactionBase>(
    doc: T,
    repo: Repository<T>,
    postingInput: PostingInput,
  ): Promise<GLEntry[]> {
    if (doc.docstatus !== 1) throw new Error('Only submitted documents can be cancelled');

    const glRepo = this.ctx.getRepository(GLEntry);
    const originals = await glRepo.find({
      where: {
        referenceDoctype: postingInput.referenceDoctype,
        referenceDocId: postingInput.referenceDocId,
        isReversal: false,
      },
    });

    if (!originals.length) throw new Error('No GLEntries found for this document');

    const reversals = await this.postingService.cancel(originals, postingInput);

    doc.docstatus = 2;
    doc.cancelledAt = new Date();
    await repo.save(doc);

    return reversals;
  }
}
