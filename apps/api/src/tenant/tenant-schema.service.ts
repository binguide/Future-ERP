import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Tenant } from '../entities/tenant.entity';
import { assertSafeSchemaName } from './tenant-context';

// SQL migrations run inside a tenant schema after provisioning.
// Extended as new tenant-scoped entities are introduced.
const TENANT_MIGRATIONS: string[] = [
  `
    CREATE TABLE IF NOT EXISTS "users" (
      id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      email       VARCHAR(255) NOT NULL UNIQUE,
      name        VARCHAR(255) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role        VARCHAR(20) NOT NULL DEFAULT 'user',
      is_active   BOOLEAN NOT NULL DEFAULT TRUE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS "doctypes" (
      id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      name           VARCHAR(255) NOT NULL UNIQUE,
      label          VARCHAR(255) NOT NULL,
      module         VARCHAR(255),
      is_child       BOOLEAN NOT NULL DEFAULT FALSE,
      is_single      BOOLEAN NOT NULL DEFAULT FALSE,
      is_submittable BOOLEAN NOT NULL DEFAULT FALSE,
      tracking       VARCHAR(20) NOT NULL DEFAULT 'None',
      description    TEXT,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS "docfields" (
      id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      doctype_id     uuid NOT NULL REFERENCES "doctypes"(id),
      fieldname      VARCHAR(255) NOT NULL,
      label          VARCHAR(255) NOT NULL,
      fieldtype      VARCHAR(255) NOT NULL,
      options        VARCHAR(255),
      idx            INTEGER NOT NULL DEFAULT 0,
      is_mandatory   BOOLEAN NOT NULL DEFAULT FALSE,
      is_read_only   BOOLEAN NOT NULL DEFAULT FALSE,
      is_unique      BOOLEAN NOT NULL DEFAULT FALSE,
      default_value  VARCHAR(255),
      description    TEXT,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS "data_documents" (
      id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      doctype_id  uuid NOT NULL REFERENCES "doctypes"(id),
      data        JSONB NOT NULL DEFAULT '{}',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_data_documents_doctype
    ON "data_documents"(doctype_id)
  `,
];

@Injectable()
export class TenantSchemaService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async provisionSchema(tenant: Tenant): Promise<void> {
    const schema = assertSafeSchemaName(tenant.schemaName);
    // Pin ONE connection: the unqualified CREATE TABLE statements rely on the
    // search_path set just before them, so both must run on the same connection
    // or the tables (and their FKs) land in `public` instead of the schema.
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    try {
      await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
      await queryRunner.query(`SET search_path TO "${schema}"`);
      for (const sql of TENANT_MIGRATIONS) {
        await queryRunner.query(sql);
      }
    } finally {
      await queryRunner.release();
    }
  }

  async schemaExists(schemaName: string): Promise<boolean> {
    const result = await this.dataSource.query(
      `SELECT EXISTS(SELECT 1 FROM information_schema.schemata WHERE schema_name = $1)`,
      [schemaName],
    );
    return result[0].exists;
  }

  async dropSchema(tenant: Tenant): Promise<void> {
    const schema = assertSafeSchemaName(tenant.schemaName);
    await this.dataSource.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  }
}
