import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Tenant } from '../entities/tenant.entity';
import { assertSafeSchemaName } from './tenant-context';

// SQL migrations run inside a tenant schema after provisioning.
// Extended as new tenant-scoped entities are introduced.
const ALL_TENANT_TABLES = [
  'data_documents', 'doctypes', 'docfields', 'roles', 'permissions',
  'user_permissions', 'approval_authorities', 'companies', 'branches',
  'currencies', 'exchange_rates', 'fiscal_years', 'cost_centers', 'accounts',
  'gl_entries', 'transaction_docs', 'workflows', 'workflow_states',
  'workflow_transitions', 'workflow_actions', 'doc_versions', 'activity_logs',
  'comments',
] as const;

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
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by     uuid,
      modified_by    uuid
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
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by     uuid,
      modified_by    uuid
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
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by     uuid,
      modified_by    uuid
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
      is_reversal       BOOLEAN NOT NULL DEFAULT FALSE,
      reversal_of       uuid REFERENCES "gl_entries"(id),
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
  `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_gl_entries_reversal_of_unique
    ON "gl_entries"(reversal_of) WHERE reversal_of IS NOT NULL
  `,
  `
    CREATE TABLE IF NOT EXISTS "transaction_docs" (
      id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      company_id        uuid NOT NULL REFERENCES "companies"(id),
      title             VARCHAR(255) NOT NULL,
      posting_date      DATE NOT NULL,
      docstatus         SMALLINT NOT NULL DEFAULT 0,
      submitted_at      TIMESTAMPTZ,
      submitted_by      uuid,
      cancelled_at      TIMESTAMPTZ,
      cancelled_by      uuid,
      workflow_state_id uuid,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `,

  `
    CREATE TABLE IF NOT EXISTS "workflows" (
      id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      doctype_id    uuid NOT NULL REFERENCES "doctypes"(id),
      workflow_name VARCHAR(255) NOT NULL,
      is_active     BOOLEAN NOT NULL DEFAULT FALSE,
      condition     TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_workflows_doctype_active
    ON "workflows"(doctype_id, is_active)
  `,
  `
    CREATE TABLE IF NOT EXISTS "workflow_states" (
      id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      workflow_id uuid NOT NULL REFERENCES "workflows"(id),
      state_name  VARCHAR(255) NOT NULL,
      docstatus   SMALLINT NOT NULL DEFAULT 0,
      is_editable BOOLEAN NOT NULL DEFAULT TRUE,
      is_terminal BOOLEAN NOT NULL DEFAULT FALSE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(workflow_id, state_name)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS "workflow_transitions" (
      id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      workflow_id   uuid NOT NULL REFERENCES "workflows"(id),
      from_state_id uuid NOT NULL REFERENCES "workflow_states"(id),
      to_state_id   uuid NOT NULL REFERENCES "workflow_states"(id),
      role_id       uuid NOT NULL REFERENCES "roles"(id),
      condition     TEXT,
      action        VARCHAR(20) NOT NULL DEFAULT 'Approve',
      sequence      INTEGER NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(workflow_id, from_state_id, to_state_id, role_id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS "workflow_actions" (
      id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      doctype_id        uuid NOT NULL REFERENCES "doctypes"(id),
      reference_doc_id  uuid NOT NULL,
      from_state_id     uuid,
      to_state_id       uuid NOT NULL,
      action            VARCHAR(20) NOT NULL,
      user_id           uuid NOT NULL,
      comment           TEXT NOT NULL,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `,
  `
    ALTER TABLE "workflow_transitions" ADD COLUMN IF NOT EXISTS action VARCHAR(20) NOT NULL DEFAULT 'Approve'
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_workflow_actions_doc
    ON "workflow_actions"(doctype_id, reference_doc_id)
  `,
  `
    CREATE TABLE IF NOT EXISTS "doc_versions" (
      id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      doctype_id        uuid NOT NULL REFERENCES "doctypes"(id),
      reference_doc_id  uuid NOT NULL,
      old_data          JSONB,
      new_data          JSONB NOT NULL,
      version_number    INTEGER NOT NULL DEFAULT 1,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by        uuid,
      modified_by       uuid,
      UNIQUE(doctype_id, reference_doc_id, version_number)
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_doc_versions_doc
    ON "doc_versions"(doctype_id, reference_doc_id)
  `,
  `
    CREATE TABLE IF NOT EXISTS "activity_logs" (
      id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      doctype_id        uuid NOT NULL REFERENCES "doctypes"(id),
      reference_doc_id  uuid NOT NULL,
      activity_type     VARCHAR(50) NOT NULL,
      user_id           uuid,
      message           TEXT,
      old_value         JSONB,
      new_value         JSONB,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by        uuid,
      modified_by       uuid
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_activity_logs_doc
    ON "activity_logs"(doctype_id, reference_doc_id)
  `,
  `
    CREATE TABLE IF NOT EXISTS "comments" (
      id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      doctype_id        uuid NOT NULL REFERENCES "doctypes"(id),
      reference_doc_id  uuid NOT NULL,
      user_id           uuid,
      content           TEXT NOT NULL,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by        uuid,
      modified_by       uuid
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_comments_doc
    ON "comments"(doctype_id, reference_doc_id)
  `,
  // System-stamp columns for ALL tenant tables — generated from one list
  // so every table gets created_by + modified_by without per-table duplication.
  ...ALL_TENANT_TABLES.flatMap(t => [
    `ALTER TABLE "${t}" ADD COLUMN IF NOT EXISTS created_by uuid`,
    `ALTER TABLE "${t}" ADD COLUMN IF NOT EXISTS modified_by uuid`,
  ]),
  // Append-only PG triggers for audit tables (DB-level enforcement)
  `CREATE OR REPLACE FUNCTION reject_audit_modify() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'audit tables are append-only'; END;
    $$ LANGUAGE plpgsql`,
  ...['doc_versions', 'activity_logs', 'comments'].flatMap(t => [
    `DROP TRIGGER IF EXISTS ${t}_append_only ON "${t}"`,
    `CREATE TRIGGER ${t}_append_only
      BEFORE UPDATE OR DELETE ON "${t}"
      FOR EACH ROW EXECUTE FUNCTION reject_audit_modify()`,
  ]),
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
