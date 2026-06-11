import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Doctype } from '../entities/doctype.entity';
import { DataDocument } from '../entities/data-document.entity';

@Injectable()
export class ResourceService {
  constructor(
    @InjectRepository(Doctype)
    private readonly doctypeRepo: Repository<Doctype>,
    @InjectRepository(DataDocument)
    private readonly docRepo: Repository<DataDocument>,
  ) {}

  private async resolveDoctype(name: string): Promise<Doctype> {
    const doctype = await this.doctypeRepo.findOne({ where: { name } });
    if (!doctype) {
      throw new NotFoundException(`Doctype ${name} not found`);
    }
    return doctype;
  }

  async list(doctypeName: string) {
    const doctype = await this.resolveDoctype(doctypeName);
    return this.docRepo.find({
      where: { doctype: { id: doctype.id } },
      order: { createdAt: 'DESC' },
    });
  }

  async get(doctypeName: string, id: string) {
    const doctype = await this.resolveDoctype(doctypeName);
    return this.docRepo.findOne({
      where: { id, doctype: { id: doctype.id } },
    });
  }

  async create(doctypeName: string, data: Record<string, unknown>) {
    const doctype = await this.resolveDoctype(doctypeName);
    const doc = this.docRepo.create({ doctype, data });
    return this.docRepo.save(doc);
  }

  async update(doctypeName: string, id: string, data: Record<string, unknown>) {
    const doctype = await this.resolveDoctype(doctypeName);
    const doc = await this.docRepo.findOne({
      where: { id, doctype: { id: doctype.id } },
    });
    if (!doc) return null;
    doc.data = { ...doc.data, ...data } as Record<string, unknown>;
    return this.docRepo.save(doc);
  }
}
