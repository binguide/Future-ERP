import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { validateEnv } from './config/env.schema';
import { DatabaseModule } from './config/database.module';
import { TenantContextModule } from './tenant/tenant-context.module';
import { TenantModule } from './tenant/tenant.module';
import { TenantMiddleware } from './tenant/tenant.middleware';
import { UserModule } from './user/user.module';
import { AuthModule } from './auth/auth.module';
import { DoctypeModule } from './doctype/doctype.module';
import { ResourceModule } from './resource/resource.module';
import { PermissionsModule } from './permissions/permissions.module';
import { PostingModule } from './accounting/posting.module';
import { WorkflowModule } from './workflow/workflow.module';
import { HierarchyResolverService } from './common/hierarchy-resolver.service';
import { RequestContextModule } from './common/request-context.module';
import { RequestContextInterceptor } from './common/request-context.interceptor';
import { AuditModule } from './audit/audit.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      ignoreEnvFile: process.env.NODE_ENV === 'test',
    }),
    RequestContextModule,
    AuditModule,
    DatabaseModule,
    TenantContextModule,
    TenantModule,
    UserModule,
    AuthModule,
    DoctypeModule,
    ResourceModule,
    PermissionsModule,
    PostingModule,
    WorkflowModule,
  ],
  controllers: [AppController],
  providers: [
    HierarchyResolverService,
    { provide: APP_INTERCEPTOR, useClass: RequestContextInterceptor },
  ],
  exports: [HierarchyResolverService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
