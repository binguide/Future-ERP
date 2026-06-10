# OpenERP-X — Agent Execution Plan (mid-tier model)

> **ملخّص (عربي):** خطة تنفيذ موجَّهة لوكيل برمجة بنموذج متوسط القدرة. المهام صغيرة ومرقّمة ولكل واحدة
> معيار قبول قابل للاختبار. ٩ مراحل (٠–٨): الأساس، المحاسبة، المخزون، المبيعات، المشتريات، نقاط البيع،
> الفوترة الإلكترونية السعودية (ZATCA)، الأصول، الصقل. المرجع: [PRD.md](PRD.md) والقواعد في [../AGENTS.md](../AGENTS.md).

> This plan targets an **automated coding agent** executing the project task-by-task. It assumes a
> **mid-tier model**, so tasks are small, explicit, and each has an **executable acceptance
> criterion**. Authoritative scope/architecture: [PRD.md](PRD.md); governing rules: [../AGENTS.md](../AGENTS.md).

---

## Part A — Agent operating model (read before any task)

### Working principles
1. **One task at a time.** Do not start a task before its `Depends` are complete.
2. **Task size = one small reviewable PR** with its tests.
3. **TDD is mandatory for all financial/stock logic** (posting, cancellation, valuation, hierarchy
   resolution): write the test with known-result numbers first, then implement until green.
4. **"Done" means**: tests + `lint` + `typecheck` clean + the acceptance criterion verified by
   actually running it (do not assume).
5. **Stop and ask** if a task is ambiguous, requires changing an invariant, or needs a missing dependency.
6. **Do not add paid dependencies** (the whole stack is MIT/OSS — see PRD appendix أ).

### Task template (follow literally)
```
ID:            T<phase>.<n>
Depends:       [list of IDs]
Goal:          one sentence
Read first:    relevant PRD files/sections
Steps:         short numbered steps
Files:         specific paths to create/modify
Acceptance:    executable tests/checks (this is the definition of success)
Red lines:     the invariants this task must not break
```
> Each item below lists **Depends + Goal + Acceptance** in brief; the agent expands it to the full
> template before implementing.

### Pre-submit checklist (red lines — from AGENTS.md)
- [ ] No financial number outside `GLEntry`; every posting is **balanced in base currency** and inside **one DB transaction**.
- [ ] Tenant isolation intact (schema-per-tenant + `search_path`); **no** `tenant_id` column.
- [ ] Document lifecycle respected: `Save` has no effect, `Submit` generates entries and locks, `Cancel` reverses; submitted docs never deleted.
- [ ] If Workflow is enabled: no `Submit` before the **Approved** state.
- [ ] Hierarchy resolution uses the shared resolver ("most specific wins"); no new local logic.
- [ ] Service items: no stock movement and no inventory/COGS entry.
- [ ] Every list/report respects row-level permission filtering (company/branch/warehouse).
- [ ] Audit log / `DocVersion` is append-only.

### Inter-phase gates
Do not move to the next phase before passing its **phase gate** (🚦 at the end of each phase): a set
of tests/checks proving the phase's foundations are sound. These are suggested human review points.

---

## Local run & demo (keep it runnable — "walking skeleton")

The project must be **runnable and manually testable at the end of every phase**, not only covered by
automated tests. Rules:
- **One-command up**: `docker compose up` (PostgreSQL 17 + Valkey + Mailpit), then `pnpm dev` (API + web together).
- **`pnpm seed`** loads a demo tenant + admin user + sample data, so there is always something real to click.
- **Swagger UI** at `/docs` to try the API by hand; **Mailpit UI** to inspect outgoing email; **ZATCA Sandbox** for e-invoicing.
- Every phase ends with a **Demo checkpoint** (under its 🚦 gate): a short click-through proving the new capability works in the running app.
- **Never end a task with a broken `pnpm dev`.** Extend `pnpm seed` whenever a new doctype/feature lands.

## Part B — Task breakdown by phase

Phases follow the PRD roadmap (section 9) with a **deliberate refinement**: **Sales** is split from
**Purchasing** (two independent phases), **POS** is split from **Assets** (two independent phases),
and a **Saudi e-invoicing (ZATCA)** phase is added, making **9 phases (0–8)**. Each task reads:
**ID — Goal.** `Depends:` … `Acceptance:` …

> Ordering note: Sales precedes Purchasing (as in the PRD); Sales does not require Purchasing to be
> finished because opening stock is entered via `StockReconciliation` (T2.18). Setup shared by both
> cycles (tax, payment modes, communications) is built in the Sales phase and reused by Purchasing.

---

### Phase 0 — Foundation

#### 0.0 Scaffolding
- **T0.1 — Init monorepo.** Depends: —. Create `pnpm-workspace.yaml`, `turbo.json`,
  `tsconfig.base.json`, ESLint + Prettier, `.gitignore`. Acceptance: `pnpm install` succeeds cleanly.
- **T0.2 — Create packages.** Depends: T0.1. `apps/api` (NestJS 11), `apps/web` (Vite + React 19),
  `packages/shared` (types + Zod). Acceptance: API and web both boot locally.
- **T0.3 — Infra & env.** Depends: T0.2. `docker-compose.yml` for PostgreSQL 17 + Valkey;
  `@nestjs/config` with Zod validation. Acceptance: `docker compose up` brings up both stores; API connects to PostgreSQL.
- **T0.4 — Turborepo pipeline + Jest.** Depends: T0.3. Wire `build/dev/test/lint` + Jest + Supertest.
  **Update the Commands section in AGENTS.md with the real, verified commands** (run one test, create/run TypeORM migrations).
- 🚦 **Gate 0.0**: `pnpm install && pnpm build && pnpm lint && pnpm test` all green.

#### 0.1 Multi-tenancy
- **T0.5 — Public-schema entities.** Depends: T0.4. `Tenant`, `Subscription`, `TenantUser` + migration. Acceptance: migration runs and reverts cleanly.
- **T0.6 — Tenant resolution + search_path.** Depends: T0.5. Middleware (subdomain/JWT) + interceptor
  that sets `search_path` per request. Acceptance: two requests for different tenants hit different schemas.
- **T0.7 — Tenant schema provisioning.** Depends: T0.6. Service to create a schema + run tenant migrations. Acceptance: creating a tenant creates its schema and tables.
- **T0.8 — Isolation test.** Depends: T0.7. Acceptance: two tenants; proves data of one cannot be read from the other's context.
- 🚦 **Gate 0.1**: isolation test green; no `tenant_id` column in any tenant table.

#### 0.2 Authentication
- **T0.9 — User entity + argon2.** Depends: T0.7. Acceptance: password stored as an argon2 hash, not plaintext.
- **T0.10 — JWT + login.** Depends: T0.9. `passport-jwt` strategy + `login` endpoint; token carries tenant + user. Acceptance: login returns a valid JWT.
- **T0.11 — Auth guard.** Depends: T0.10. Acceptance: e2e — a protected route is rejected without a token and accepted with a valid one.

#### 0.3 Metadata engine
- **T0.12 — Doctype + DocField.** Depends: T0.7. Both entities + migration. Acceptance: a doctype definition and its fields can be stored.
- **T0.13 — Doctype registry.** Depends: T0.12. Service to register/query fields. Acceptance: querying a doctype's fields returns the definition.
- **T0.14 — Generic Masters CRUD.** Depends: T0.13. Metadata-driven controller (list/get/create/update). Acceptance: a new master doctype works without custom code.

#### 0.4 Permissions (CASL)
- **T0.15 — Permission entities.** Depends: T0.14. `Role`, `Permission`, `UserPermission`, `ApprovalAuthority`. Acceptance: migration + linking a user to roles.
- **T0.16 — CASL ability factory.** Depends: T0.15. Build Ability from doctype permissions. Acceptance: ability reflects the role's permissions.
- **T0.17 — Guard + row-level filter.** Depends: T0.16. Guard on CRUD + (company/branch/warehouse) filter on lists. Acceptance: a user cannot see outside their scope.
- **T0.18 — Row-level filter test.** Depends: T0.17. Acceptance: a test proves rows outside the user's scope are hidden.

#### 0.5 General Ledger core (the heart)
- **T0.19 — Accounting setup entities.** Depends: T0.14. `Company` (base currency + default valuation +
  allow-negative), `Branch`, `Currency`, `ExchangeRate`, `FiscalYear`, `CostCenter`, `Account` (tree per company). Acceptance: migrations + basic creation.
- **T0.20 — GLEntry entity.** Depends: T0.19. Acceptance: entity carries account/debit/credit/currency/rate/base-amount/date/reference/dimensions.
- **T0.21 — PostingService.** Depends: T0.20. The **only** API that writes balanced entries inside **one
  DB transaction**; verifies "debit = credit in base currency"; rejects posting in a closed fiscal period. Acceptance: see T0.22.
- **T0.22 — Exhaustive posting tests.** Depends: T0.21. Acceptance: balanced accepted; unbalanced rejected;
  multi-currency balances in base; atomic rollback on any failed line; posting in a closed period rejected.
- 🚦 **Gate 0.5**: no path other than `PostingService` writes to `GLEntry`.

#### 0.6 Document lifecycle primitive
- **T0.23 — Transaction base.** Depends: T0.21. Abstract class with `docstatus` 0/1/2 and `Submit`/`Cancel` hooks. Acceptance: state transitions are guarded.
- **T0.24 — Submit/Cancel.** Depends: T0.23. `Submit` generates entries and locks; `Cancel` generates exact reversals; submitted docs are not editable/deletable. Acceptance: see T0.25.
- **T0.25 — Lifecycle tests.** Depends: T0.24. Acceptance: editing/deleting a submitted doc is blocked; Cancel nets out the effect; double-submit prevented.

#### 0.7 Hierarchy resolver
- **T0.26 — Shared resolver.** Depends: T0.19. `resolve(item → group → company)` + variant `item → warehouse → company` (most specific wins). Acceptance: see T0.27.
- **T0.27 — Ordering tests.** Depends: T0.26. Acceptance: prove the most-specific level wins at every level and for both variants.

#### 0.8 Workflow engine
- **T0.28 — Workflow entities.** Depends: T0.15. `Workflow`, `WorkflowState`, `WorkflowTransition`, `WorkflowAction`. Acceptance: migration + defining a workflow for a doctype.
- **T0.29 — Approval engine.** Depends: T0.28, T0.24. Transitions gated by role + condition; multi-level
  escalation via `ApprovalAuthority`; **Approved** required before `Submit`; **Reject** returns to draft with mandatory reason. Acceptance: see T0.30.
- **T0.30 — Workflow tests.** Depends: T0.29. Acceptance: submit blocked before approval; escalation when value exceeds the ceiling; every approve/reject logged; reject requires a reason.
- 🚦 **Gate 0.8**: a doc with Workflow enabled generates no `GLEntry` before **Approved**.

#### 0.9 Audit & change tracking
- **T0.31 — System stamps.** Depends: T0.14. Subscriber for `created/modified by/at`. Acceptance: every record carries the stamps automatically.
- **T0.32 — DocVersion + timeline.** Depends: T0.31. Field-level diff (old→new) when tracking is enabled + `ActivityLog` + `Comment`, append-only. Acceptance: see T0.33.
- **T0.33 — Audit tests.** Depends: T0.32. Acceptance: diff recorded; log append-only; survives document deletion.

#### 0.10 Report engine + DataGrid
- **T0.34 — Generic server-side query.** Depends: T0.17. Filter (AND/OR + operators), multi-sort,
  group + subtotals, pagination — **respects row-level filtering**. Acceptance: a complex query is correct and never leaks outside the user's scope.
- **T0.35 — Export.** Depends: T0.34. Excel/CSV (ExcelJS) + PDF (Puppeteer). Acceptance: export matches the displayed data.
- **T0.36 — DataGrid component.** Depends: T0.34. TanStack Table v8 + Virtual + shadcn/ui; preferences saved in `UserViewPreference`. Acceptance: all PRD section 6 features work and persist.
#### 0.11 Seed & dev tooling (keep it runnable)
- **T0.37 — Seed & demo data.** Depends: T0.14, T0.19. `pnpm seed` creates a demo tenant + admin user +
  one company + a small Chart of Accounts + a few master records (items, warehouse). Extend it in every
  later phase as new doctypes land. Acceptance: after `pnpm seed`, logging into the web app shows real data in the DataGrid.
- **T0.38 — Dev tooling.** Depends: T0.4. Swagger UI at `/docs`; **Mailpit** added to docker-compose
  (captures outgoing email); a `/health` endpoint; `pnpm dev` runs API + web concurrently. Acceptance: `/docs` and the Mailpit UI load; `pnpm dev` brings up a clickable app.

- 🚦 **Gate 0.10 (end of phase)**: 100k-row performance < 2s; permission filtering respected; all DataGrid features work.
  **Demo checkpoint:** `docker compose up` + `pnpm dev` + `pnpm seed`, then log in as the demo admin, open
  Swagger at `/docs`, open a metadata-driven list in the DataGrid (filter/sort/paginate), and toggle Arabic/RTL.

---

### Phase 1 — Setup & Accounting

- **T1.1 — Company master + UI.** Depends: T0.19, T0.36. Acceptance: create/edit a company with base currency, default valuation, allow-negative.
- **T1.2 — Branch master (hierarchical).** Depends: T1.1. Acceptance: a branch linked to a company; later appears as a dimension on entries.
- **T1.3 — Currency + ExchangeRate.** Depends: T1.1. Date-effective rates. Acceptance: rate lookup returns the effective one for a date.
- **T1.4 — FiscalYear + period closing.** Depends: T1.1, T0.21. Acceptance: posting in a closed period is rejected (proven by test).
- **T1.5 — Chart of Accounts + template.** Depends: T1.1. A ready template applied on company creation, editable. Acceptance: a new company comes with an editable default tree.
- **T1.6 — CostCenter master.** Depends: T1.1. Acceptance: a cost center used as a dimension on entries.
- **T1.7 — JournalEntry (full cycle).** Depends: T0.24, T1.5. Multi-line entry + attachments, via lifecycle + `PostingService`. Acceptance: Save has no effect; Submit generates balanced entries; Cancel reverses.
- **T1.8 — JournalEntry multi-currency.** Depends: T1.7, T1.3. Per-entry toggle reveals foreign columns; auto base conversion; balanced in base despite differing line currencies. Acceptance: an entry with mixed-currency lines balances in base.
- **T1.9 — User column pinning.** Depends: T1.8, T0.36. Persist the foreign-column visibility preference in `UserViewPreference`. Acceptance: the preference auto-applies for the user.
- **T1.10 — General Ledger report (drill-down).** Depends: T0.34, T1.7. Acceptance: from an account balance to the constituent entries.
- **T1.11 — Trial Balance.** Depends: T1.10. Acceptance: total debit = total credit.
- **T1.12 — Balance Sheet.** Depends: T1.11. Acceptance: Assets − (Liabilities + Equity) = 0.
- **T1.13 — Profit & Loss.** Depends: T1.11. Acceptance: net profit matches total revenue − expense for the period.
- **T1.14 — Cash Flow.** Depends: T1.13. Acceptance: flows match movement of cash/bank accounts.
- **T1.15 — Party ledger.** Depends: T1.10. Acceptance: a customer/supplier statement with a correct running balance.
- **T1.16 — AR/AP aging.** Depends: T1.15. Acceptance: correct aging buckets by due date.
- **T1.17 — FX revaluation (job).** Depends: T1.8. BullMQ; generates a period-end difference entry. Acceptance: the revaluation entry is balanced and correctly valued.
- 🚦 **Gate 1**: Trial Balance balanced; (Assets − Liabilities − Equity) = 0; multi-currency entry balanced in base.
  **Demo checkpoint:** create a company, build the CoA from template, post a journal entry (and a multi-currency one), then open Trial Balance and Balance Sheet and confirm they balance.

---

### Phase 2 — Inventory (linked to accounting)

- **T2.1 — Item master.** Depends: T1.1. Stock/service, barcode, image, group link. Acceptance: a service item is clearly flagged to skip stock.
- **T2.2 — ItemGroup (hierarchical).** Depends: T2.1. Acceptance: a group tree usable in hierarchy resolution.
- **T2.3 — UOM + UOMConversion.** Depends: T2.1. Base unit + conversion factors. Acceptance: buying/selling in any unit auto-converts to base on submit.
- **T2.4 — Warehouse (hierarchical).** Depends: T1.2. Linked to branch/company + allow-negative override. Acceptance: balance computed per (item × warehouse).
- **T2.5 — Batch.** Depends: T2.1. Batch number + expiry date. Acceptance: a batch movement tracks quantity and expiry.
- **T2.6 — SerialNo.** Depends: T2.1. Unique number per unit. Acceptance: traced from receipt to sale.
- **T2.7 — StockLedgerEntry.** Depends: T2.4. Stock movement entity (+ FIFO queue field). Acceptance: each movement recorded as a row.
- **T2.8 — ItemDefault.** Depends: T2.1, T2.2. Account linking + valuation method at item/group level. Acceptance: values are read by the resolver.
- **T2.9 — Account-linking resolution.** Depends: T0.26, T2.8. (Inventory/SRBNB/COGS/Revenue/valuation-difference) item→group→company. Acceptance: order proven by test.
- **T2.10 — Valuation-method resolution.** Depends: T0.26, T2.8. item→group→company. Acceptance: two items with different methods in the same company.
- **T2.11 — Allow-negative resolution.** Depends: T0.26, T2.4. item→warehouse→company. Acceptance: order proven by test.
- **T2.12 — ValuationStrategy: MovingAverage.** Depends: T2.7. Stores running value and average. Acceptance: correct average after receipts at different prices.
- **T2.13 — ValuationStrategy: FIFO.** Depends: T2.7. Cost-layer queue per (item × warehouse). Acceptance: consumption in arrival order is correct.
- **T2.14 — SerialNo path.** Depends: T2.6, T2.13. Valued at the serial's actual cost. Acceptance: sale cost = the received serial's cost.
- **T2.15 — Post stock movement to GL.** Depends: T2.9, T0.21. Via `PostingService` (perpetual inventory); **service items skip**. Acceptance: a service-item movement generates no inventory/COGS entry.
- **T2.16 — Receipt entry.** Depends: T2.15. Dr Inventory / Cr Stock-Received-But-Not-Billed. Acceptance: balanced, correctly valued entry.
- **T2.17 — COGS entry on sale.** Depends: T2.15. Dr COGS / Cr Inventory at cost. Acceptance: cost from the correct ValuationStrategy.
- **T2.18 — Stock operations.** Depends: T2.16, T2.17. Receipt/issue/transfer + `StockReconciliation`. Acceptance: each operation generates correct movement and entry.
- **T2.19 — Valuation-method lock & change.** Depends: T2.10, T2.18. Locks after first movement; change via reconciliation or `change_valuation_method` permission with **automatic revaluation** from the cut-off. Acceptance: changing after movements triggers revaluation, not a silent switch.
- **T2.20 — Negative-stock handling.** Depends: T2.11, T2.13. Reject when off; last-known cost when on + later settlement. Acceptance: rejection works; settlement corrects entries when quantity arrives.
- **T2.21 — FIFO recompute on cancel/back-date.** Depends: T2.13, T0.24. Acceptance: cancel/back-dated edit rebuilds the queue and entries correctly.
- **T2.22 — Inventory reports.** Depends: T0.34, T2.18. Balance, ledger, aging, valuation, reorder level, batch/serial balances, near-expiry, reconciliation diffs. Acceptance: valuation matches the stock ledger.
- 🚦 **Gate 2**: two items with different methods cost correctly; negative rejected when off; cost settled when on (PRD section 10).
  **Demo checkpoint:** create stock + service items, receive stock and view the balance/valuation, then sell from stock and view the COGS entry.

---

### Phase 3 — Sales

#### Shared setup for both cycles (built here, reused by Purchasing)
- **T3.1 — TaxTemplate (shared).** Depends: T1.5. Sales/purchase, line/doc, cumulative/rate, output/input accounts. Acceptance: tax posts to the correct account.
- **T3.2 — ModeOfPayment (shared).** Depends: T1.5, T1.2. Linked to an account + branch/company. Acceptance: the cash account differs across branches.

#### Sales parties
- **T3.3 — Customer master (credit limit).** Depends: T1.1. Acceptance: a credit-limit field used as a gate later.
- **T3.4 — PriceList.** Depends: T2.1, T1.3. Multiple lists in different currencies. Acceptance: price fetched by list and currency.

#### Sales cycle
- **T3.5 — Quotation.** Depends: T3.3, T3.4, T0.24. Acceptance: a quotation converts to a sales order with reference tracking.
- **T3.6 — SalesOrder + credit limit.** Depends: T3.5, T0.29. Exceeding the limit escalates to finance-manager approval. Acceptance: exceeding the limit blocks submission until approved.
- **T3.7 — DeliveryNote (deducts stock).** Depends: T3.6, T2.17. Partial delivery and quantity carry-forward. Acceptance: stock deducted and outgoing cost posted.
- **T3.8 — SalesInvoice.** Depends: T3.7, T3.1, T2.17. Posts revenue + tax + COGS. Acceptance: balanced entries including revenue, tax, and cost of sale.
- **T3.9 — PaymentEntry (receipt) + split payment.** Depends: T3.8, T3.2. Closes receivables; FX difference on settlement. Acceptance: amount split across payment modes; correct FX-difference entry.
- **T3.10 — Sales return (Credit Note).** Depends: T3.8. Reversing entries and movements. Acceptance: the return reverses revenue, stock, and cost accurately.
- **T3.11 — Line/doc discounts.** Depends: T3.8. Acceptance: discount reflected in net amount and entries.
- **T3.12 — Sales reference tracking.** Depends: T3.5. Each sales doc linked to its predecessor. Acceptance: quotation→order→delivery→invoice chain is traceable.
- **T3.13 — Wire Sales workflow.** Depends: T0.29, T3.6. Multi-level approval + value/credit-limit escalation. Acceptance: escalation works per `ApprovalAuthority`.

#### Communications (shared infra reused by Purchasing and Reports)
- **T3.14 — Communications (send).** Depends: T0.35, T3.8. `ChannelProvider` (SMTP + WhatsApp Cloud),
  `MessageTemplate` (Arabic/English), "Send" button → PDF. Acceptance: a document is sent by email/WhatsApp; WhatsApp respects approved templates and the 24-hour window.
- **T3.15 — Notification rules (job).** Depends: T3.14. `NotificationRule` via BullMQ (approval pending, invoice overdue, stock below reorder, near-expiry). Acceptance: an event triggers the notification to the right channel/recipient.
- **T3.16 — CommunicationLog.** Depends: T3.14. Channel/recipient/content/time/delivery status + opt-in. Acceptance: every send is logged with its status.
- 🚦 **Gate 3**: every sale produces balanced entries + correct movements in an atomic transaction; a sales return reverses accurately; credit limit governs submission.
  **Demo checkpoint:** run a full Quotation→SalesOrder→DeliveryNote→SalesInvoice→PaymentEntry cycle, then email the invoice PDF and see it arrive in Mailpit.

---

### Phase 4 — Purchasing

- **T4.1 — Supplier master.** Depends: T1.1. Acceptance: a supplier linkable to purchase documents.
- **T4.2 — MaterialRequest.** Depends: T4.1, T0.24. Acceptance: a material request converts to a purchase order with reference.
- **T4.3 — RFQ + SupplierQuotation + comparison.** Depends: T4.2. Acceptance: compare supplier quotations to pick the best.
- **T4.4 — PurchaseOrder (spending authority).** Depends: T4.3, T0.29. Not sent to the supplier until approved. Acceptance: approval gates sending/submission.
- **T4.5 — PurchaseReceipt (adds stock).** Depends: T4.4, T2.16. Partial receipt. Acceptance: stock increases and the receipt entry is posted.
- **T4.6 — PurchaseInvoice.** Depends: T4.5, T3.1. Posts inventory/expense + tax. Acceptance: balanced entries; service items expensed directly without receipt.
- **T4.7 — Three-way match (gate).** Depends: T4.6. PO ↔ Receipt ↔ Invoice within allowed tolerance. Acceptance: variance beyond tolerance blocks approval.
- **T4.8 — Purchase return (Debit Note).** Depends: T4.6. Acceptance: reverses stock and liability accurately.
- **T4.9 — Landed Cost.** Depends: T4.5. Distribute extra costs onto item cost. Acceptance: item cost increases by its allocated share.
- **T4.10 — Purchase reference + workflow + reuse comms.** Depends: T4.2, T0.29, T3.14. Link the purchase chain + multi-level approval + send PO/invoice via the T3.14 infra. Acceptance: request→order→receipt→invoice chain traceable, escalation works, sends logged.
- 🚦 **Gate 4**: every purchase produces balanced entries + correct movements in an atomic transaction; three-way match failure blocks approval; Debit Note reverses accurately.
  **Demo checkpoint:** run a full MaterialRequest→PurchaseOrder→PurchaseReceipt→PurchaseInvoice cycle and watch a three-way-match failure block approval.

---

### Phase 5 — Point of Sale (POS)

- **T5.1 — POSSession.** Depends: T3.2. Open/close shift + cash count and reconciliation. Acceptance: closing the shift reconciles expected vs. actual cash.
- **T5.2 — Cashier UI.** Depends: T5.1, T2.1. Barcode/name search + quick add to cart. Acceptance: fast selling works per branch/warehouse.
- **T5.3 — Split payment in POS.** Depends: T5.2, T3.9. Cash + card + customer balance. Acceptance: splitting the amount across modes is correct.
- **T5.4 — POS invoice posting.** Depends: T5.3, T3.8. **Same entries/movements as a regular sales invoice.** Acceptance: a POS invoice generates revenue + tax + COGS + stock movement.
- **T5.5 — POS reports.** Depends: T0.34, T5.4. By shift/cashier, payment-mode mix, drawer reconciliation, daily summary. Acceptance: summary matches the shift's invoices.
- 🚦 **Gate 5**: a POS invoice = a sales invoice in accounting/stock effect; drawer reconciliation correct.
  **Demo checkpoint:** make a POS sale with split payment (cash + card) and close the shift with a cash count.

---

### Phase 6 — Saudi e-invoicing (ZATCA / FATOORA)

ZATCA (Zakat, Tax and Customs Authority) compliance: **Phase 1 (Generation)** + **Phase 2
(Integration)**. Enabled per Saudi tenant only (a toggleable setting), and breaks no
accounting/stock invariant — it adds a generation/signing/transmission layer on top of the
**submitted** invoice.

> **Regulatory references**: UBL 2.1, ECDSA signing, certificate via EGS-unit registration, QR with
> TLV encoding, hash chain (PIH), invoice counter (ICV). Two flows: **Clearance** for the standard
> (B2B) tax invoice, **Reporting** for the simplified (B2C/POS) invoice. Arabic is mandatory. Always
> work against the **Sandbox** before production.

#### Setup & registration
- **T6.1 — Tax & identity prerequisite fields.** Depends: T1.1, T3.1, T3.3. Add VAT number, CR number,
  and national address to `Company`/`Branch`/`Customer`, and tax categories (taxable/exempt/zero-rated/out-of-scope) in `TaxTemplate`. Acceptance: the invoice carries all mandatory seller and buyer fields.
- **T6.2 — Tenant onboarding & EGS registration.** Depends: T0.7, T6.1. Generate a CSR, request the
  **CSID** via Compliance then the **PCSID** via the Production CSID API; store the certificate/private
  key **isolated and securely per tenant/device** (never plaintext in the schema). Acceptance: Sandbox onboarding succeeds and stores the CSID securely.

#### Generation & signing
- **T6.3 — Invoice model extensions.** Depends: T3.8. Add `UUID`, sequential `ICV` per EGS, `PIH`
  (previous invoice hash), invoice type (standard/simplified, B2B/B2C). Acceptance: ZATCA fields complete and counter sequential with no gaps.
- **T6.4 — UBL 2.1 XML generator.** Depends: T6.3. Generate compliant XML with ZATCA fields/extensions (Arabic). Acceptance: XML passes schema/Schematron validation in the ZATCA tool.
- **T6.5 — Hashing & cryptographic stamp.** Depends: T6.2, T6.4. SHA-256 hash, ECDSA signature/stamp,
  embedded digital signature per ZATCA rules, and `PIH` chaining into a continuous chain. Acceptance: signed XML is valid and the hash chain is unbroken.
- **T6.6 — QR code (TLV).** Depends: T6.5. Seller name, VAT number, timestamp, total, VAT, XML hash,
  ECDSA signature, public key (+ certificate signature for Phase 2). Acceptance: QR decodes to every TLV tag and validates in the ZATCA app.

#### Transmission & flows
- **T6.7 — Clearance flow (B2B standard).** Depends: T6.5, T3.14. Call the Clearance API **before**
  delivering the invoice to the buyer; store the cleared invoice and ZATCA response; block sharing before clearance. Acceptance: standard invoice cleared on Sandbox before issuance; failure blocks delivery.
- **T6.8 — Reporting flow (B2C/POS simplified).** Depends: T6.5, T5.4. Report to the Reporting API
  within **24 hours** asynchronously via **BullMQ** with retry on failure and status tracking. Acceptance: simplified/POS invoice reported within the window; retries on failure.
- **T6.9 — Print templates (A4 + POS thermal).** Depends: T6.6, T3.14. Bilingual with QR and all mandatory fields. Acceptance: the printed invoice shows the QR and mandatory fields in Arabic.
- **T6.10 — E-credit/debit notes.** Depends: T6.7, T6.8, T3.10, T4.8. Reference the original invoice +
  reason, and follow the same clearance/reporting path. Acceptance: the note references the original and clears/reports correctly.

#### Oversight
- **T6.11 — Compliance status & audit report.** Depends: T0.34, T6.7, T6.8. Per-invoice status
  (cleared/reported/failed), `PIH` chain integrity, and submission log. Acceptance: the report shows status and flags any chain break.
- 🚦 **Gate 6**: standard invoices cleared before issuance; simplified/POS reported within 24h; QR and
  signed UBL pass ZATCA validation; `PIH` chain continuous; each tenant's certs/keys isolated and secure.
  **Demo checkpoint:** generate a standard and a simplified invoice on the ZATCA Sandbox, scan the QR, and view the cleared/reported status.

---

### Phase 7 — Fixed Assets

- **T7.1 — AssetCategory.** Depends: T1.5. Account links (asset/accumulated-depreciation/depreciation-expense). Acceptance: values read at posting time.
- **T7.2 — Asset register + purchase.** Depends: T7.1, T4.6. From a purchase invoice or manual. Acceptance: buying an asset registers it and links its account.
- **T7.3 — DepreciationSchedule.** Depends: T7.2. Straight-line/declining. Acceptance: a correct schedule by method and life.
- **T7.4 — Auto depreciation posting (job).** Depends: T7.3, T0.21. BullMQ + `@nestjs/schedule`. Acceptance: a depreciation entry posts automatically on its date and is balanced.
- **T7.5 — Asset disposal.** Depends: T7.2. Gain/loss computation. Acceptance: the disposal entry nets out the asset and its accumulation and records the gain/loss.
- **T7.6 — Asset reports.** Depends: T0.34, T7.5. Register, depreciation schedule, movement, disposal. Acceptance: matches the asset register.
- 🚦 **Gate 7**: depreciation posts automatically on date and is balanced; disposal records gain/loss correctly.
  **Demo checkpoint:** create an asset, run the depreciation job, and view the posted depreciation entry.

---

### Phase 8 — Polish & launch readiness

- **T8.1 — Fine-grained permissions.** Depends: T0.17. Complete doctype permissions (create/read/update/delete/submit/cancel/approve/reject) per module. Acceptance: a full, testable permission matrix.
- **T8.2 — Consolidated reports across companies.** Depends: T1.12. Acceptance: financial statements consolidated across the tenant's companies.
- **T8.3 — Dimensional reports.** Depends: T1.10. Per branch/cost-center/project. Acceptance: dimensional filtering correct and balanced.
- **T8.4 — Dashboards.** Depends: T0.34. `Dashboard`, `DashboardChart`/`KPI` (Recharts + Socket.IO) + drill-down. Acceptance: role-based cards with realtime updates and drill-down links.
- **T8.5 — Scheduled reports.** Depends: T3.14. `ScheduledReport` via BullMQ, email/WhatsApp delivery. Acceptance: a periodic report is sent automatically.
- **T8.6 — Saved report views.** Depends: T0.36. `SavedReportView` per user. Acceptance: report preferences are restored.
- **T8.7 — Performance hardening.** Depends: Gate 0.10. Index dimensions/references + query tuning. Acceptance: lists < 2s at 100k records.
- **T8.8 — i18n/RTL audit.** Depends: —. Acceptance: no hardcoded strings; all strings via i18next; RTL layouts sound.
- **T8.9 — Inter-company transactions (staged).** Depends: T1.7. Acceptance: an inter-company transaction generates matching balanced entries in both companies.
- 🚦 **Gate 8 (launch readiness)**: the PRD general acceptance criteria (section 10) are covered by green tests, **and the Phase 6 (ZATCA) gate is passed** for any Saudi tenant.
  **Demo checkpoint:** open the dashboards and a consolidated report across two companies.

---

## Part C — Mitigating "mid-tier model" risks

- **Golden tests**: for every posting/cancellation path, a scenario with fixed, known-result numbers; prevents financial drift.
- **No reinvention**: always call `PostingService` and the shared resolver; new local posting/hierarchy logic is forbidden (rejected in review).
- **Small, revertible tasks**: each task in its own branch/PR, reviewed against the checklist.
- **"Forbidden" list**: no deleting submitted documents, no financial numbers outside GL, no `tenant_id`, no bypassing Workflow, no paid dependencies.
- **Stop on ambiguity** beats guessing: if the acceptance criterion is not executable, reword the task before starting.
