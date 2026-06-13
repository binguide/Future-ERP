import { Injectable } from '@nestjs/common';
import { TenantContextService } from '../tenant/tenant-context.service';
import { Doctype } from '../entities/doctype.entity';
import { DocVersion } from '../entities/doc-version.entity';
import { ActivityLog } from '../entities/activity-log.entity';
import { Comment } from '../entities/comment.entity';
import { RequestContextService } from '../common/request-context.service';

@Injectable()
export class AuditService {
  constructor(
    private readonly ctx: TenantContextService,
    private readonly requestCtx: RequestContextService,
  ) {}

  private get docVersionRepo() {
    return this.ctx.getRepository(DocVersion);
  }

  private get activityLogRepo() {
    return this.ctx.getRepository(ActivityLog);
  }

  private get commentRepo() {
    return this.ctx.getRepository(Comment);
  }

  async recordVersion(
    doctypeId: string,
    referenceDocId: string,
    oldData: Record<string, unknown> | null,
    newData: Record<string, unknown>,
  ): Promise<DocVersion> {
    const last = await this.docVersionRepo.findOne({
      where: { doctypeId, referenceDocId },
      order: { versionNumber: 'DESC' },
    });
    const versionNumber = last ? last.versionNumber + 1 : 1;
    const doc = this.docVersionRepo.create({
      doctypeId,
      referenceDocId,
      oldData,
      newData,
      versionNumber,
    });
    return this.docVersionRepo.save(doc);
  }

  async logActivity(
    doctypeId: string,
    referenceDocId: string,
    activityType: string,
    message: string,
    oldValue?: Record<string, unknown> | null,
    newValue?: Record<string, unknown> | null,
  ): Promise<ActivityLog> {
    const userId = this.requestCtx.getCurrentUserId();
    const entry = this.activityLogRepo.create({
      doctypeId,
      referenceDocId,
      activityType,
      userId,
      message,
      oldValue: oldValue ?? null,
      newValue: newValue ?? null,
    });
    return this.activityLogRepo.save(entry);
  }

  async addComment(
    doctypeId: string,
    referenceDocId: string,
    content: string,
  ): Promise<Comment> {
    const userId = this.requestCtx.getCurrentUserId();
    const comment = this.commentRepo.create({
      doctypeId,
      referenceDocId,
      userId,
      content,
    });
    return this.commentRepo.save(comment);
  }

  async getVersions(doctypeId: string, referenceDocId: string): Promise<DocVersion[]> {
    return this.docVersionRepo.find({
      where: { doctypeId, referenceDocId },
      order: { versionNumber: 'ASC' },
    });
  }

  async getActivityLog(doctypeId: string, referenceDocId: string): Promise<ActivityLog[]> {
    return this.activityLogRepo.find({
      where: { doctypeId, referenceDocId },
      order: { createdAt: 'ASC' },
    });
  }

  async getComments(doctypeId: string, referenceDocId: string): Promise<Comment[]> {
    return this.commentRepo.find({
      where: { doctypeId, referenceDocId },
      order: { createdAt: 'ASC' },
    });
  }

  async shouldTrack(doctypeId: string): Promise<boolean> {
    const doctype = await this.ctx.getRepository(Doctype).findOneByOrFail({ id: doctypeId });
    return doctype.tracking !== 'None';
  }

  async resolveDoctypeByName(name: string): Promise<Doctype | null> {
    return this.ctx.getRepository(Doctype).findOne({ where: { name } });
  }
}
