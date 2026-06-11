import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Observable } from 'rxjs';

@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();
    const schemaName: string | undefined = (request as any).tenantSchema;

    if (schemaName) {
      await this.dataSource.query(`SET search_path TO ${schemaName}, public`);
    } else {
      await this.dataSource.query('SET search_path TO public');
    }

    return next.handle();
  }
}
