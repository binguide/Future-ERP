import { Injectable, NestMiddleware } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Request, Response, NextFunction } from 'express';
import { TenantService } from './tenant.service';
import { tenantStorage, assertSafeSchemaName } from './tenant-context';
import { Tenant } from '../entities/tenant.entity';
import './tenant-request';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly tenantService: TenantService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const domain = this.extractDomain(req);
    let tenant: Tenant | null = null;
    if (domain) {
      try {
        tenant = await this.tenantService.resolveByDomain(domain);
      } catch {
        tenant = null;
      }
    }

    const schemaName =
      tenant && tenant.isActive ? assertSafeSchemaName(tenant.schemaName) : null;

    // Pin ONE pooled connection for the whole request and set its search_path,
    // so the request's tenant-scoped queries (run via TenantContextService on the
    // same connection) hit the tenant schema. Released when the response ends.
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      void queryRunner.release();
    };
    res.once('finish', release);
    res.once('close', release);

    try {
      if (schemaName) {
        await queryRunner.query(`SET search_path TO "${schemaName}", public`);
        req.tenant = tenant!;
        req.tenantSchema = schemaName;
      } else {
        await queryRunner.query('SET search_path TO public');
      }
    } catch (err) {
      release();
      next(err as Error);
      return;
    }

    tenantStorage.run(
      {
        schemaName: schemaName ?? 'public',
        manager: queryRunner.manager,
      },
      next,
    );
  }

  private extractDomain(req: Request): string | null {
    if (req.headers['x-tenant']) {
      return req.headers['x-tenant'] as string;
    }
    const host = req.headers['host'];
    if (!host) return null;
    const parts = host.split(':')[0].split('.');
    if (parts.length >= 2 && parts[0] !== 'www' && parts[0] !== 'localhost') {
      return parts[0];
    }
    return null;
  }
}
