import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from '../entities/tenant.entity';
import { TenantService } from './tenant.service';
import { TenantSchemaService } from './tenant-schema.service';
import { TenantMiddleware } from './tenant.middleware';
import { TenantInterceptor } from './tenant.interceptor';

@Module({
  imports: [TypeOrmModule.forFeature([Tenant])],
  providers: [
    TenantService,
    TenantSchemaService,
    TenantMiddleware,
    TenantInterceptor,
  ],
  exports: [TenantService, TenantSchemaService, TenantMiddleware, TenantInterceptor],
})
export class TenantModule {}
