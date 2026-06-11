# AGENTS.md

This file provides project guidance for AI coding agents (OpenCode and any agent that reads the
`AGENTS.md` standard) working in this repository. It is the single source of truth for agent rules;
keep it up to date as the project evolves.

## Project status

This is a **greenfield repository**. The only content so far is the product spec at
[docs/PRD.md](docs/PRD.md) (Arabic) and the executable build plan at
[docs/AGENT_PLAN.md](docs/AGENT_PLAN.md). No code, `package.json`, or build tooling exists yet.
The PRD is the authoritative source of truth for architecture, scope, and the chosen tech
stack — read it before scaffolding or implementing anything. When the spec and any later code
disagree, treat the spec as intent and reconcile explicitly rather than silently following code.

The product is **ERPFuture**: a multi-tenant SaaS ERP (accounting, inventory, sales, purchasing,
POS, fixed assets, tax) modeled closely on **ERPNext/Frappe** concepts.

## How to work in this repo (agent workflow)

- Execute the project task-by-task following [docs/AGENT_PLAN.md](docs/AGENT_PLAN.md): one task per
  change, smallest reviewable unit, with its tests. Do not start a task before its `يعتمد على`
  dependencies are done.
- **TDD is mandatory for all financial/stock logic** (posting, cancellation, valuation, hierarchy
  resolution): write the test with known-good numbers first, then implement until green.
- "Done" = tests pass + lint + typecheck clean + the task's acceptance criterion verified by actually
  running it (do not assume).
- **Stop and ask** if a task is ambiguous, requires changing an invariant below, or needs a missing
  dependency. Prefer asking over guessing.
- **Keep the project runnable and demoable**: never end a task with a broken `pnpm dev`, and extend
  `pnpm seed` as features land so each phase can be tried by hand. Every phase has a **Demo checkpoint**
  (a manual click-through) under its gate in [docs/AGENT_PLAN.md](docs/AGENT_PLAN.md), alongside the
  automated tests. Local stack: `docker compose up` (PostgreSQL + Valkey + Mailpit) then `pnpm dev`;
  Swagger UI at `/docs`, Mailpit UI for email.
- **Version control**: commit each task on its own branch with a message referencing the task ID
  (e.g. `T0.1: init monorepo`). One task = one branch = one reviewable commit/PR.
- Run the pre-submit checklist (see end of this file) before declaring any task complete.

## Tech stack (fixed by the PRD, appendix أ)

- **Monorepo**: pnpm workspaces + Turborepo (share types/DTOs between frontend and backend).
- **Backend**: Node.js 22 LTS, TypeScript, **NestJS 11** (modular + DI), **TypeORM** (chosen over
  Prisma specifically because it supports per-tenant `search_path` switching), **PostgreSQL 17**.
- **Frontend**: Vite, **React 19**, TypeScript, TanStack Query (server state), Zustand (local
  state), React Hook Form + Zod, **TanStack Table v8 + TanStack Virtual + shadcn/ui** for the
  generic DataGrid, Tailwind, `i18next` (Arabic/English + RTL).
- **Auth/AuthZ**: `@nestjs/passport` + `passport-jwt`, `argon2` for password hashing,
  **CASL** for RBAC + row-level rules.
- **Background work**: BullMQ + Valkey (scheduled reports, revaluation, depreciation, notifications).
- **Validation**: Zod shared between frontend and backend where possible.
- Other: Swagger/OpenAPI, Socket.IO (realtime dashboards/notifications), Nodemailer + MJML,
  WhatsApp Cloud API, Puppeteer (HTML→PDF), ExcelJS, Pino logging, Jest + Supertest.
- **Saudi e-invoicing (ZATCA/FATOORA)**: Node `crypto` for ECDSA (P-256) signing + X.509/CSR,
  UBL 2.1 invoice XML generation + signing, QR (TLV/base64), SHA-256 invoice hashing + PIH chain.
  All OSS. Per-tenant EGS certificates and private keys are stored **isolated and encrypted**,
  never as plaintext in the tenant schema (see invariant 2). Always run against ZATCA Sandbox
  before production.

Do not introduce paid/enterprise dependencies (e.g. AG Grid Enterprise) — the stack is
deliberately all-MIT/OSS.

## Commands

| Command | Description |
|---|---|
| `pnpm install` | Install all workspace dependencies |
| `pnpm build` | Build all packages (Turborepo) |
| `pnpm dev` | Run all packages in dev mode (Turborepo) |
| `pnpm test` | Run all tests (Turborepo) |
| `pnpm lint` | Run all linters (Turborepo) |
| `pnpm --filter @erpfuture/api test` | Run API unit tests only |
| `pnpm --filter @erpfuture/api test:e2e` | Run API e2e tests |
| `pnpm --filter @erpfuture/api test -- --testPathPattern=app.controller` | Run a single test file |
| `pnpm --filter @erpfuture/shared build` | Build shared package only |
| `docker compose up` | Start PostgreSQL 17 + Valkey + Mailpit |

**TypeORM migrations** (added when TypeORM is introduced in Phase 0.1):
- `pnpm --filter @erpfuture/api typeorm migration:create src/migrations/MigrationName`
- `pnpm --filter @erpfuture/api typeorm migration:run`
- `pnpm --filter @erpfuture/api typeorm migration:revert`

## Architecture: invariants that must never be broken

These are the governing rules from the PRD. Most cut across many modules, so they are easy to
violate locally without seeing the whole picture.

### 1. Double-entry GL is the heart
Every operational action with a financial effect **must** produce balanced `GLEntry` rows
(sum of debit = sum of credit in the company's base currency). There are no financial numbers
that live outside the general ledger. Balance is enforced in base currency even when line
currencies differ.

### 2. Schema-per-tenant isolation
One PostgreSQL database, **one schema per tenant**, plus a shared `public` schema holding
`Tenant`, `Subscription`, `TenantUser`. On every request the tenant is resolved (subdomain or
JWT) and the connection's `search_path` is set to that tenant's schema. **Never** add a
`tenant_id` column to tenant tables as a substitute — the PRD explicitly rejects that approach.
No data may ever leak across tenants.

### 3. Document lifecycle: Save vs. Submit vs. Cancel
The Frappe/ERPNext model distinguishes two kinds of documents:
- **Masters** (Item, Customer, Account, Warehouse, Company...): saved directly, editable anytime,
  no accounting/stock effect of their own.
- **Transactions** (invoices, orders, journal entries, stock movements) flow through
  `docstatus`: **Draft (0) → Submitted (1) → Cancelled (2)**.
  - **Save** stores a draft with **zero** accounting/stock effect; freely editable/deletable.
  - **Submit** is the *only* point where `GLEntry` and `StockLedgerEntry` rows are generated, and
    the document locks (no direct edits afterward).
  - **Cancel** generates exact reversing entries/movements. Editing a submitted doc = cancel,
    then copy + edit. Submitted documents are never deleted.

Every posting (invoice, voucher, stock movement) happens inside **a single DB transaction** —
all entries/movements commit together or none do.

### 4. Workflow gates Submit
When a Workflow is enabled on a doctype, a document cannot reach **Submitted** (and thus cannot
generate any GL/stock entry) until it reaches the terminal **Approved** state. Approval is a gate
*on* submission, not a separate step. The engine is metadata-driven (`Workflow`, `WorkflowState`,
`WorkflowTransition`, `WorkflowAction`) and configured per doctype — never hard-code approval
logic inside a module. Transitions carry authorized roles + optional conditions; approval is
multi-level and auto-escalates when a value exceeds a role's `ApprovalAuthority` ceiling.

### 5. Three-level resolution hierarchy (the "most specific wins" pattern)
Several features resolve a value by walking **Item → Item Group → Company default**:
- **Account linking** for perpetual inventory (Inventory, Stock-Received-But-Not-Billed, COGS,
  Revenue, valuation-difference accounts).
- **Valuation method** (Moving Average vs. FIFO).

For **negative-stock permission** the hierarchy is **Item → Warehouse → Company default**.
Implement this resolution once and reuse it; the order and "most specific wins" semantics are
acceptance criteria and must be test-provable.

### 6. Perpetual inventory: stock moves auto-post to GL
Every stock movement automatically posts accounting entries using the account hierarchy above
(e.g. purchase receipt: Dr Inventory / Cr Stock-Received-But-Not-Billed; sale: Dr COGS /
Cr Inventory at cost, alongside the invoice's revenue entry). **Service items** generate no stock
movement and no inventory/COGS entry — they post directly to revenue (sale) or expense (purchase).

### 7. Valuation strategy is pluggable and locks after first movement
Valuation is abstracted behind a `ValuationStrategy` interface with `MovingAverage` and `FIFO`
implementations, selected per item via the three-level hierarchy. Two items in the same company
can use different methods. A method is freely changeable only while the item has **no stock
movement**; after the first movement it locks. Changing it later requires `Stock Reconciliation`
at a cut-off date, **or** a holder of the special `change_valuation_method` permission — which
must trigger an automatic **revaluation** from the cut-off (never a silent switch) so the ledger
stays consistent. FIFO stores a per-(item × warehouse) cost-layer queue inside the stock ledger
entries for retroactive recompute on cancel/back-dated edits.

### 8. Multi-currency
Base currency per company + multiple transaction currencies with date-effective exchange rates.
Journal entries have a **per-entry multi-currency toggle** that reveals foreign-currency columns;
line currencies may differ within one entry but balance is always checked in base currency.
Per-user column-visibility preferences are stored in `UserViewPreference`.

### 9. Metadata-driven everything
Doctypes and their fields are defined centrally (`Doctype`, `DocField`); list screens, filters,
and permissions are inherited from metadata. New document types should be addable via metadata
without modifying the core. The generic **DataGrid** (PRD section 6) is one reusable component:
server-side filtering/grouping/sorting/pagination (required for performance at 100k+ rows),
bulk actions, export, and per-user/per-doctype saved view preferences.

### 10. Audit trail is append-only
System stamps (`created_by/at`, `modified_by/at`) on every record. When change tracking is
enabled on a doctype, every edit records a **field-level diff** (old → new value) in `DocVersion`,
surfaced in the document's timeline (`ActivityLog`). The audit log is append-only, survives
document deletion, and is gated by a dedicated role.

## Permissions model (two levels)
1. **Doctype permissions** per Role: create/read/update/delete/submit/cancel/**approve**/**reject**.
2. **Row-level (User) permissions**: restrict a user to specific company/branch/warehouse data.
   **Every report and list must respect this filter** — a user never sees data outside their
   authorized company/branch/warehouse.

`ApprovalAuthority` gives each role a per-doctype value ceiling feeding the Workflow escalation.

## Build order
The PRD roadmap (section 9) is the original 6-phase sequence. The **executable build plan** lives in
[docs/AGENT_PLAN.md](docs/AGENT_PLAN.md), which refines it into **9 phases (0–8)** with numbered,
acceptance-tested tasks — splitting sales from purchasing and POS from assets, and adding a Saudi
e-invoicing phase:

**Phase 0** foundation (multi-tenancy, auth, metadata, generic DataGrid, GL core, Workflow engine,
report engine, audit/change-tracking) → **Phase 1** setup + accounting → **Phase 2** inventory
(+ 3-level account linking) → **Phase 3** sales (+ tax, payment modes, communications/email/WhatsApp
shared infra) → **Phase 4** purchasing (+ three-way match) → **Phase 5** POS → **Phase 6** ZATCA
e-invoicing (per-tenant, KSA only) → **Phase 7** fixed assets → **Phase 8** polish (fine-grained
permissions, consolidated/dimensional reports, dashboards, performance, i18n).

Build foundational primitives (GL, posting transaction, hierarchy resolver, workflow, audit) before
module features depend on them. ZATCA is a per-tenant compliance layer **above** the submitted
invoice — it adds generation/signing/transmission and must not alter GL/stock postings.

## Conventions
- **Bilingual + RTL**: all UI strings go through i18next (Arabic/English); layouts support RTL.
- Code identifiers are English; preserve domain terms matching the PRD's entity names
  (`GLEntry`, `StockLedgerEntry`, `SalesInvoice`, `ItemDefault`, `WorkflowTransition`, ...).
- Heavy edge-case test coverage is expected for every posting and cancellation path
  (returns, retroactive cost adjustment) — these are called out as the top project risk.

## Pre-submit checklist (run before declaring any task done)
- [ ] No financial number lives outside `GLEntry`; every posting is **balanced in base currency**
      and inside **one DB transaction**.
- [ ] Tenant isolation intact (schema-per-tenant + `search_path`); **no** `tenant_id` column.
- [ ] Document lifecycle respected: `Save` has no effect, `Submit` generates entries and locks,
      `Cancel` reverses; submitted docs are never deleted.
- [ ] If a Workflow is enabled: no `Submit` before the **Approved** state.
- [ ] Hierarchy resolution uses the shared resolver ("most specific wins"); no new local logic.
- [ ] Service items produce no stock movement and no inventory/COGS entry.
- [ ] Every list/report respects row-level permission filtering (company/branch/warehouse).
- [ ] Audit log / `DocVersion` is append-only.
- [ ] ZATCA: certs/keys isolated and encrypted per tenant; e-invoicing never alters GL/stock.
- [ ] The app still boots (`pnpm dev`); the current phase's manual demo path works; `pnpm seed` updated for anything new.
- [ ] Tests + lint + typecheck pass; acceptance criterion verified by running it.
