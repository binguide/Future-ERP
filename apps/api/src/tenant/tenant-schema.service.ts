import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Tenant } from '../entities/tenant.entity';

@Injectable()
export class TenantSchemaService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async provisionSchema(tenant: Tenant): Promise<void> {
    await this.dataSource.query(
      `CREATE SCHEMA IF NOT EXISTS "${tenant.schemaName}"`,
    );
  }

  async schemaExists(schemaName: string): Promise<boolean> {
    const result = await this.dataSource.query(
      `SELECT EXISTS(SELECT 1 FROM information_schema.schemata WHERE schema_name = $1)`,
      [schemaName],
    );
    return result[0].exists;
  }

  async dropSchema(tenant: Tenant): Promise<void> {
    await this.dataSource.query(
      `DROP SCHEMA IF EXISTS "${tenant.schemaName}" CASCADE`,
    );
  }
}
