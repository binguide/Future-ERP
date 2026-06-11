import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TenantService } from './tenant.service';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private readonly tenantService: TenantService) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    const domain = this.extractDomain(req);
    if (domain) {
      try {
        const tenant = await this.tenantService.resolveByDomain(domain);
        if (tenant && tenant.isActive) {
          (req as any).tenant = tenant;
          (req as any).tenantSchema = tenant.schemaName;
        }
      } catch {
        // silently continue without tenant context
      }
    }
    next();
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
