import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { Doctype } from '../entities/doctype.entity';
import { DocField } from '../entities/docfield.entity';
import { TenantContextService } from '../tenant/tenant-context.service';

@Injectable()
export class DoctypeService {
  constructor(private readonly ctx: TenantContextService) {}

  // doctypes/docfields are tenant-scoped: resolve repos from the request's
  // pinned connection so they hit the tenant schema, not the shared pool.
  private get doctypeRepo() {
    return this.ctx.getRepository(Doctype);
  }
  private get docfieldRepo() {
    return this.ctx.getRepository(DocField);
  }

  async register(name: string, label: string, fields: Partial<DocField>[], module?: string): Promise<Doctype> {
    const existing = await this.doctypeRepo.findOne({ where: { name } });
    if (existing) {
      throw new ConflictException(`Doctype ${name} already exists`);
    }

    const doctype = await this.doctypeRepo.save(
      this.doctypeRepo.create({ name, label, module }),
    );

    const docFields = fields.map((f, i) =>
      this.docfieldRepo.create({ ...f, idx: i, doctype }),
    );
    await this.docfieldRepo.save(docFields);

    return this.doctypeRepo.findOne({
      where: { id: doctype.id },
      relations: { fields: true },
    }) as Promise<Doctype>;
  }

  async findByName(name: string): Promise<Doctype | null> {
    return this.doctypeRepo.findOne({
      where: { name },
      relations: { fields: true },
      order: { fields: { idx: 'ASC' } },
    });
  }

  async list(): Promise<Doctype[]> {
    return this.doctypeRepo.find();
  }

  async getFields(name: string): Promise<DocField[]> {
    const doctype = await this.findByName(name);
    if (!doctype) {
      throw new NotFoundException(`Doctype ${name} not found`);
    }
    return doctype.fields;
  }
}
