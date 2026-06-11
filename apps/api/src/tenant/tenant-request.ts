import { Tenant } from '../entities/tenant.entity';

/**
 * Augments Express `Request` with the tenant context attached by
 * `TenantMiddleware`, so handlers/interceptors can read `req.tenant` /
 * `req.tenantSchema` without `as any` casts.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      tenant?: Tenant;
      tenantSchema?: string;
    }
  }
}

export {};
