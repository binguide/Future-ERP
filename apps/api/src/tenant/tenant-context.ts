import { AsyncLocalStorage } from 'node:async_hooks';
import { EntityManager } from 'typeorm';

/**
 * Per-request tenant context. Holds the EntityManager bound to the single
 * pooled connection on which this request's `search_path` was set, so every
 * tenant-scoped query in the request runs against the correct schema.
 */
export interface TenantStore {
  schemaName: string;
  manager: EntityManager;
}

export const tenantStorage = new AsyncLocalStorage<TenantStore>();

const SAFE_SCHEMA_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * Guards against SQL identifier injection: schema names are interpolated into
 * `CREATE/DROP SCHEMA` and `SET search_path` DDL that cannot be parameterised.
 * Only lower-case ASCII identifiers (Postgres-foldable, ≤ 63 bytes) are allowed.
 */
export function assertSafeSchemaName(name: string): string {
  if (!SAFE_SCHEMA_NAME.test(name)) {
    throw new Error(`Unsafe schema name: ${JSON.stringify(name)}`);
  }
  return name;
}
