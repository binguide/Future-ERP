import { Global, Module } from '@nestjs/common';
import { TenantContextService } from './tenant-context.service';

/**
 * Global so any tenant-scoped service can inject TenantContextService without
 * importing TenantModule (avoids cross-module wiring for a request primitive).
 */
@Global()
@Module({
  providers: [TenantContextService],
  exports: [TenantContextService],
})
export class TenantContextModule {}
