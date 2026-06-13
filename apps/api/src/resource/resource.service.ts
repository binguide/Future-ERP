import { Injectable, NotFoundException } from '@nestjs/common';
import { Brackets } from 'typeorm';
import { Doctype } from '../entities/doctype.entity';
import { DataDocument } from '../entities/data-document.entity';
import { UserPermission } from '../entities/user-permission.entity';
import { TenantContextService } from '../tenant/tenant-context.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class ResourceService {
  constructor(
    private readonly ctx: TenantContextService,
    private readonly auditService: AuditService,
  ) {}

  private get doctypeRepo() {
    return this.ctx.getRepository(Doctype);
  }
  private get docRepo() {
    return this.ctx.getRepository(DataDocument);
  }
  private get userPermRepo() {
    return this.ctx.getRepository(UserPermission);
  }

  private async resolveDoctype(name: string): Promise<Doctype> {
    const doctype = await this.doctypeRepo.findOne({ where: { name } });
    if (!doctype) {
      throw new NotFoundException(`Doctype ${name} not found`);
    }
    return doctype;
  }

  async list(doctypeName: string, userId?: string) {
    const doctype = await this.resolveDoctype(doctypeName);

    if (userId) {
      const scopeConditions = await this.buildScopeConditions(doctype.id, userId);
      if (scopeConditions.length > 0) {
        // Scope keys ('company_id'/'branch_id'/'warehouse_id') live inside the
        // jsonb `data` column, so match them via ->> rather than whole-column
        // equality. Each scope is ANDed internally; scopes are ORed together.
        const qb = this.docRepo
          .createQueryBuilder('doc')
          .where('doc.doctype_id = :doctypeId', { doctypeId: doctype.id })
          .orderBy('doc.created_at', 'DESC');

        qb.andWhere(
          new Brackets((outer) => {
            scopeConditions.forEach((scope, i) => {
              outer.orWhere(
                new Brackets((inner) => {
                  Object.entries(scope).forEach(([key, val], j) => {
                    const param = `scope_${i}_${j}`;
                    inner.andWhere(`doc.data ->> '${key}' = :${param}`, {
                      [param]: val,
                    });
                  });
                }),
              );
            });
          }),
        );

        return qb.getMany();
      }
    }

    return this.docRepo.find({
      where: { doctype: { id: doctype.id } },
      order: { createdAt: 'DESC' },
    });
  }

  async get(doctypeName: string, id: string, userId?: string) {
    const doctype = await this.resolveDoctype(doctypeName);
    const doc = await this.docRepo.findOne({
      where: { id, doctype: { id: doctype.id } },
    });

    // Row-level scope check on get
    if (doc && userId) {
      const allowed = await this.isScopedAllowed(doctype.id, doc, userId);
      if (!allowed) return null;
    }

    return doc;
  }

  async create(doctypeName: string, data: Record<string, unknown>) {
    const doctype = await this.resolveDoctype(doctypeName);
    const doc = this.docRepo.create({ doctype, data });
    const saved = await this.docRepo.save(doc);

    if (await this.auditService.shouldTrack(doctype.id)) {
      await this.auditService.recordVersion(doctype.id, saved.id, null, data);
      await this.auditService.logActivity(
        doctype.id, saved.id, 'Create', 'Document created',
      );
    }
    return saved;
  }

  async update(doctypeName: string, id: string, data: Record<string, unknown>) {
    const doctype = await this.resolveDoctype(doctypeName);
    const doc = await this.docRepo.findOne({
      where: { id, doctype: { id: doctype.id } },
    });
    if (!doc) return null;
    const oldData = { ...doc.data } as Record<string, unknown>;
    doc.data = { ...doc.data, ...data } as Record<string, unknown>;
    const saved = await this.docRepo.save(doc);

    if (await this.auditService.shouldTrack(doctype.id)) {
      await this.auditService.recordVersion(doctype.id, id, oldData, saved.data as Record<string, unknown>);
      await this.auditService.logActivity(
        doctype.id, id, 'Update', 'Document updated', oldData, saved.data as Record<string, unknown>,
      );
    }
    return saved;
  }

  private async buildScopeConditions(
    doctypeId: string,
    userId: string,
  ): Promise<Record<string, string>[]> {
    const userPerms = await this.userPermRepo.find({
      where: { doctype: { id: doctypeId }, user: { id: userId }, read: true },
    });

    const scopes = userPerms.filter(
      (p) => p.companyId || p.branchId || p.warehouseId,
    );

    if (scopes.length === 0) return [];

    return scopes.map((s) => {
      const cond: Record<string, string> = {};
      if (s.companyId) cond['company_id'] = s.companyId;
      if (s.branchId) cond['branch_id'] = s.branchId;
      if (s.warehouseId) cond['warehouse_id'] = s.warehouseId;
      return cond;
    });
  }

  private async isScopedAllowed(
    doctypeId: string,
    doc: DataDocument,
    userId: string,
  ): Promise<boolean> {
    const conditions = await this.buildScopeConditions(doctypeId, userId);
    if (conditions.length === 0) return true;

    const docData = doc.data as Record<string, any>;
    return conditions.some((scope) =>
      Object.entries(scope).every(
        ([key, val]) => docData[key] === val,
      ),
    );
  }
}
