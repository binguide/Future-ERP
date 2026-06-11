import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  EntityTarget,
  ObjectLiteral,
  Repository,
} from 'typeorm';
import { tenantStorage, assertSafeSchemaName } from './tenant-context';

/**
 * Resolves the EntityManager / repositories that tenant-scoped code must use.
 *
 * Inside a request the middleware pins one pooled connection (with the tenant's
 * `search_path` set) and stores its manager in AsyncLocalStorage; this service
 * returns that manager so queries hit the tenant schema. Outside a request (or
 * for an unresolved tenant) it falls back to the default manager (public).
 *
 * Tenant-scoped services MUST obtain repositories from here rather than via
 * `@InjectRepository`, which would use the shared pool and bypass `search_path`.
 */
@Injectable()
export class TenantContextService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  get manager(): EntityManager {
    return tenantStorage.getStore()?.manager ?? this.dataSource.manager;
  }

  getRepository<T extends ObjectLiteral>(target: EntityTarget<T>): Repository<T> {
    return this.manager.getRepository(target);
  }

  /**
   * Runs `fn` bound to a tenant schema on a dedicated pinned connection, outside
   * any HTTP request — for seed scripts, background jobs, and tests. Tenant-scoped
   * services called within `fn` resolve to this schema.
   */
  async runInTenant<T>(schemaName: string, fn: () => Promise<T>): Promise<T> {
    const schema = assertSafeSchemaName(schemaName);
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    try {
      await queryRunner.query(`SET search_path TO "${schema}", public`);
      return await tenantStorage.run(
        { schemaName: schema, manager: queryRunner.manager },
        fn,
      );
    } finally {
      await queryRunner.release();
    }
  }
}
