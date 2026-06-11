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
  `
    CREATE TABLE IF NOT EXISTS "roles" (
      id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      name        VARCHAR(255) NOT NULL UNIQUE,
      description TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS "permissions" (
      id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      role_id     uuid NOT NULL REFERENCES "roles"(id),
      doctype_id  uuid NOT NULL REFERENCES "doctypes"(id),
      "create"    BOOLEAN NOT NULL DEFAULT FALSE,
      "read"      BOOLEAN NOT NULL DEFAULT FALSE,
      "update"    BOOLEAN NOT NULL DEFAULT FALSE,
      "delete"    BOOLEAN NOT NULL DEFAULT FALSE,
      "submit"    BOOLEAN NOT NULL DEFAULT FALSE,
      "cancel"    BOOLEAN NOT NULL DEFAULT FALSE,
      "approve"   BOOLEAN NOT NULL DEFAULT FALSE,
      "reject"    BOOLEAN NOT NULL DEFAULT FALSE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(role_id, doctype_id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS "user_permissions" (
      id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id       uuid NOT NULL REFERENCES "users"(id),
      doctype_id    uuid NOT NULL REFERENCES "doctypes"(id),
      company_id    VARCHAR(255),
      branch_id     VARCHAR(255),
      warehouse_id  VARCHAR(255),
      "create"      BOOLEAN NOT NULL DEFAULT FALSE,
      "read"        BOOLEAN NOT NULL DEFAULT FALSE,
      "update"      BOOLEAN NOT NULL DEFAULT FALSE,
      "delete"      BOOLEAN NOT NULL DEFAULT FALSE,
      "submit"      BOOLEAN NOT NULL DEFAULT FALSE,
      "cancel"      BOOLEAN NOT NULL DEFAULT FALSE,
      "approve"     BOOLEAN NOT NULL DEFAULT FALSE,
      "reject"      BOOLEAN NOT NULL DEFAULT FALSE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(user_id, doctype_id, company_id, branch_id, warehouse_id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS "approval_authorities" (
      id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      role_id       uuid NOT NULL REFERENCES "roles"(id),
      doctype_id    uuid NOT NULL REFERENCES "doctypes"(id),
      value_ceiling DECIMAL(18,2),
      can_approve   BOOLEAN NOT NULL DEFAULT FALSE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(role_id, doctype_id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS "companies" (
      id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      name                VARCHAR(255) NOT NULL UNIQUE,
      base_currency       VARCHAR(3) NOT NULL,
      default_valuation_method VARCHAR(50) NOT NULL DEFAULT 'Moving Average',
      allow_negative_stock BOOLEAN NOT NULL DEFAULT FALSE,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS "branches" (
      id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      name        VARCHAR(255) NOT NULL,
      company_id  uuid NOT NULL REFERENCES "companies"(id),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS "currencies" (
      id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      code        VARCHAR(3) NOT NULL UNIQUE,
      name        VARCHAR(255) NOT NULL,
      symbol      VARCHAR(10),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS "exchange_rates" (
      id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      currency_id   uuid NOT NULL REFERENCES "currencies"(id),
      rate          DECIMAL(18,6) NOT NULL,
      valid_from    DATE NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS "fiscal_years" (
      id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      name         VARCHAR(255) NOT NULL,
      company_id   uuid NOT NULL REFERENCES "companies"(id),
      start_date   DATE NOT NULL,
      end_date     DATE NOT NULL,
      is_closed    BOOLEAN NOT NULL DEFAULT FALSE,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS "cost_centers" (
      id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      name        VARCHAR(255) NOT NULL,
      company_id  uuid REFERENCES "companies"(id),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS "accounts" (
      id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      name            VARCHAR(255) NOT NULL,
      account_number  VARCHAR(50),
      type            VARCHAR(20) NOT NULL,
      is_group        BOOLEAN NOT NULL DEFAULT FALSE,
      company_id      uuid NOT NULL REFERENCES "companies"(id),
      parent_id       uuid REFERENCES "accounts"(id),
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(company_id, account_number)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS "gl_entries" (
      id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      company_id        uuid NOT NULL REFERENCES "companies"(id),
      account_id        uuid NOT NULL REFERENCES "accounts"(id),
      debit             DECIMAL(18,2) NOT NULL DEFAULT 0,
      credit            DECIMAL(18,2) NOT NULL DEFAULT 0,
      currency          VARCHAR(3) NOT NULL,
      exchange_rate     DECIMAL(18,6) NOT NULL DEFAULT 1,
      base_debit        DECIMAL(18,2) NOT NULL DEFAULT 0,
      base_credit       DECIMAL(18,2) NOT NULL DEFAULT 0,
      posting_date      DATE NOT NULL,
      reference_doctype VARCHAR(255) NOT NULL,
      reference_doc_id  uuid NOT NULL,
      cost_center_id    uuid,
      branch_id         uuid,
      description       TEXT,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (debit = 0 OR credit = 0)
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_gl_entries_reference
    ON "gl_entries"(reference_doctype, reference_doc_id)
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_gl_entries_company_date
    ON "gl_entries"(company_id, posting_date)
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
