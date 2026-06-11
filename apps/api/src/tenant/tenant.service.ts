import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../entities/tenant.entity';

@Injectable()
export class TenantService {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
  ) {}

  async resolveByDomain(domain: string): Promise<Tenant | null> {
    return this.tenantRepo.findOne({ where: { domain } });
  }

  async resolveOrThrow(domain: string): Promise<Tenant> {
    const tenant = await this.resolveByDomain(domain);
    if (!tenant) {
      throw new NotFoundException(`Tenant not found for domain: ${domain}`);
    }
    return tenant;
  }
}
