import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      ignoreEnvFile: process.env.NODE_ENV === 'test',
    }),
    DatabaseModule,
    TenantContextModule,
    TenantModule,
    UserModule,
    AuthModule,
    DoctypeModule,
    ResourceModule,
  ],
  controllers: [AppController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
