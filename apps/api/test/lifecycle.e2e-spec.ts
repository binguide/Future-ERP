import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Tenant } from '../src/entities/tenant.entity';
import { TenantSchemaService } from '../src/tenant/tenant-schema.service';
import { TenantContextService } from '../src/tenant/tenant-context.service';
import { PostingService } from '../src/accounting/posting.service';
import { LifecycleService } from '../src/accounting/lifecycle.service';
import { GLEntry } from '../src/entities/gl-entry.entity';
import { TransactionDocument } from '../src/entities/transaction-document.entity';
import { Company } from '../src/entities/company.entity';
import { Account, AccountType } from '../src/entities/account.entity';
import { FiscalYear } from '../src/entities/fiscal-year.entity';
import { Doctype } from '../src/entities/doctype.entity';

describe('Document lifecycle (T0.23–T0.25)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let schemaService: TenantSchemaService;
  let ctx: TenantContextService;
  let postingService: PostingService;
  let lifecycleService: LifecycleService;

  const tenant: Partial<Tenant> = {
    id: '00000000-0000-0000-0000-0000000000d0',
    name: 'Lifecycle Test',
    domain: 'lifecycle-test',
    schemaName: 't_lifecycle',
    isActive: true,
  };

  let companyId: string;
  let assetAcctId: string;
  let incomeAcctId: string;

  const inTenant = <T>(fn: () => Promise<T>): Promise<T> =>
    ctx.runInTenant(tenant.schemaName!, fn);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    dataSource = app.get(DataSource);
    schemaService = app.get(TenantSchemaService);
    ctx = app.get(TenantContextService);
    postingService = app.get(PostingService);
    lifecycleService = app.get(LifecycleService);

    await dataSource.getRepository(Tenant).upsert(tenant as Tenant, ['domain']);
    await schemaService.provisionSchema(tenant as Tenant);

    await inTenant(async () => {
      // Register the TransactionDocument doctype so workflow lookup succeeds
      await ctx.getRepository(Doctype).save(
        ctx.getRepository(Doctype).create({ name: 'TransactionDocument', label: 'Transaction Document' }),
      );

      const company = await ctx.getRepository(Company).save(
        ctx.getRepository(Company).create({ name: 'Lifecycle Co', baseCurrency: 'SAR' }),
      );
      companyId = company.id;

      assetAcctId = (
        await ctx.getRepository(Account).save(
          ctx.getRepository(Account).create({ name: 'LC Asset', type: AccountType.ASSET, companyId }),
        )
      ).id;

      incomeAcctId = (
        await ctx.getRepository(Account).save(
          ctx.getRepository(Account).create({ name: 'LC Income', type: AccountType.INCOME, companyId }),
        )
      ).id;

      await ctx.getRepository(FiscalYear).save(
        ctx.getRepository(FiscalYear).create({
          name: 'FY 2026',
          companyId,
          startDate: new Date('2026-01-01'),
          endDate: new Date('2026-12-31'),
          isClosed: false,
        }),
      );
    });
  });

  afterAll(async () => {
    await schemaService.dropSchema(tenant as Tenant).catch(() => {});
    await dataSource.getRepository(Tenant).delete({ domain: 'lifecycle-test' });
    await app.close();
  });

  const actorId = '00000000-0000-0000-0000-000000000da1';

  const refDocId = '00000000-0000-0000-0000-000000000d01';
  const refDoctype = 'TransactionDocument';

  let docId: string;

  // ── Draft / Save has no GL effect (T0.23) ──────────────
  it('saves a draft document with docstatus=0 and no GLEntries', async () => {
    const doc = await inTenant(async () => {
      const repo = ctx.getRepository(TransactionDocument);
      const saved = await repo.save(
        repo.create({
          companyId,
          title: 'Test Doc',
          postingDate: new Date('2026-07-01'),
          docstatus: 0,
        }),
      );
      return saved;
    });

    expect(doc.docstatus).toBe(0);
    expect(doc.submittedAt).toBeNull();
    expect(doc.cancelledAt).toBeNull();
    docId = doc.id;

    // No GL entries created for a draft
    const entries = await inTenant(async () => {
      const repo = ctx.getRepository(GLEntry);
      return repo.find({ where: { referenceDocId: refDocId } });
    });
    expect(entries).toHaveLength(0);
  });

  // ── Submit generates entries and locks (T0.24) ─────────
  it('submits a draft document: generates GLEntries and sets docstatus=1', async () => {
    const doc = await inTenant(async () => {
      const repo = ctx.getRepository(TransactionDocument);
      return repo.findOneByOrFail({ id: docId });
    });

    expect(doc.docstatus).toBe(0);

    const entries = await inTenant(() =>
      lifecycleService.submit(doc, ctx.getRepository(TransactionDocument), {
        companyId,
        postingDate: new Date('2026-07-01'),
        referenceDoctype: refDoctype,
        referenceDocId: refDocId,
        lines: [
          { accountId: assetAcctId, debit: 1000, credit: 0 },
          { accountId: incomeAcctId, debit: 0, credit: 1000 },
        ],
      }, actorId),
    );

    expect(entries).toHaveLength(2);

    const updated = await inTenant(async () => {
      const repo = ctx.getRepository(TransactionDocument);
      return repo.findOneByOrFail({ id: docId });
    });
    expect(updated.docstatus).toBe(1);
    expect(updated.submittedAt).toBeInstanceOf(Date);
    expect(updated.submittedBy).toBe(actorId);
    expect(updated.cancelledAt).toBeNull();

    // Verify GL entries exist and are not reversals
    const glEntries = await inTenant(async () => {
      const repo = ctx.getRepository(GLEntry);
      return repo.find({ where: { referenceDocId: refDocId, isReversal: false } });
    });
    expect(glEntries).toHaveLength(2);
    const totalDebit = glEntries.reduce((s, e) => s + Number(e.baseDebit), 0);
    const totalCredit = glEntries.reduce((s, e) => s + Number(e.baseCredit), 0);
    expect(totalDebit).toBe(totalCredit);
  });

  // ── Double-submit prevented ────────────────────────────
  it('prevents submitting an already-submitted document', async () => {
    const doc = await inTenant(async () => {
      const repo = ctx.getRepository(TransactionDocument);
      return repo.findOneByOrFail({ id: docId });
    });

    await expect(
      inTenant(() =>
        lifecycleService.submit(doc, ctx.getRepository(TransactionDocument), {
          companyId,
          postingDate: new Date('2026-07-01'),
          referenceDoctype: refDoctype,
          referenceDocId: '00000000-0000-0000-0000-000000000d02',
          lines: [
            { accountId: assetAcctId, debit: 1, credit: 0 },
            { accountId: incomeAcctId, debit: 0, credit: 1 },
          ],
        }, actorId),
      ),
    ).rejects.toThrow(/only draft/i);
  });

  // ── Cancel generates reversals and is idempotent ───────
  it('cancels a submitted document: reversal entries, docstatus=2, idempotent', async () => {
    const doc = await inTenant(async () => {
      const repo = ctx.getRepository(TransactionDocument);
      return repo.findOneByOrFail({ id: docId });
    });

    const reversals = await inTenant(() =>
      lifecycleService.cancel(doc, ctx.getRepository(TransactionDocument), {
        companyId,
        postingDate: new Date('2026-07-02'),
        referenceDoctype: refDoctype,
        referenceDocId: refDocId,
      }, actorId),
    );

    // Reversal entries exist
    expect(reversals).toHaveLength(2);
    for (const rev of reversals) {
      expect(rev.isReversal).toBe(true);
      expect(rev.reversalOf).not.toBeNull();
    }
    // Reversed amounts
    const totalRevDebit = reversals.reduce((s, e) => s + Number(e.baseDebit), 0);
    const totalRevCredit = reversals.reduce((s, e) => s + Number(e.baseCredit), 0);
    expect(totalRevDebit).toBe(totalRevCredit);

    const updated = await inTenant(async () => {
      const repo = ctx.getRepository(TransactionDocument);
      return repo.findOneByOrFail({ id: docId });
    });
    expect(updated.docstatus).toBe(2);
    expect(updated.cancelledAt).toBeInstanceOf(Date);
    expect(updated.cancelledBy).toBe(actorId);

    // ── Idempotency: second cancel is rejected ─────────
    await expect(
      inTenant(() =>
        lifecycleService.cancel(doc, ctx.getRepository(TransactionDocument), {
          companyId,
          postingDate: new Date('2026-07-02'),
          referenceDoctype: refDoctype,
          referenceDocId: refDocId,
        }, actorId),
      ),
    ).rejects.toThrow(/only submitted/i);

    // Net GL effect is zero: original + reversal entries
    const allGlEntries = await inTenant(async () => {
      const repo = ctx.getRepository(GLEntry);
      return repo.find({ where: { referenceDocId: refDocId }, order: { createdAt: 'ASC' } });
    });
    const netDebit = allGlEntries.reduce((s, e) => s + Number(e.baseDebit), 0);
    const netCredit = allGlEntries.reduce((s, e) => s + Number(e.baseCredit), 0);
    expect(netDebit).toBe(netCredit);
  });

  // ── Cancel a non-submitted doc is rejected ─────────────
  it('rejects cancelling a draft document', async () => {
    const draft = await inTenant(async () => {
      const repo = ctx.getRepository(TransactionDocument);
      return repo.save(
        repo.create({
          companyId,
          title: 'Draft Cancellation Test',
          postingDate: new Date('2026-07-01'),
          docstatus: 0,
        }),
      );
    });

    await expect(
      inTenant(() =>
        lifecycleService.cancel(draft, ctx.getRepository(TransactionDocument), {
          companyId,
          postingDate: new Date('2026-07-02'),
          referenceDoctype: refDoctype,
          referenceDocId: '00000000-0000-0000-0000-000000000d03',
        }, actorId),
      ),
    ).rejects.toThrow(/only submitted/i);
  });

  // ── PostingService.cancel() is idempotent at entry level ──
  it('PostingService.cancel rejects double-cancel on same entries', async () => {
    // Create a second document, submit it, cancel it once
    const doc2 = await inTenant(async () => {
      const repo = ctx.getRepository(TransactionDocument);
      return repo.save(
        repo.create({
          companyId,
          title: 'Idempotent Test',
          postingDate: new Date('2026-07-01'),
          docstatus: 0,
        }),
      );
    });
    const refId2 = '00000000-0000-0000-0000-000000000d04';

    await inTenant(() =>
      lifecycleService.submit(doc2, ctx.getRepository(TransactionDocument), {
        companyId,
        postingDate: new Date('2026-07-01'),
        referenceDoctype: refDoctype,
        referenceDocId: refId2,
        lines: [
          { accountId: assetAcctId, debit: 500, credit: 0 },
          { accountId: incomeAcctId, debit: 0, credit: 500 },
        ],
      }, actorId),
    );

    // Cancel once (via LifecycleService)
    await inTenant(() =>
      lifecycleService.cancel(doc2, ctx.getRepository(TransactionDocument), {
        companyId,
        postingDate: new Date('2026-07-02'),
        referenceDoctype: refDoctype,
        referenceDocId: refId2,
      }, actorId),
    );

    // Try calling PostingService.cancel() directly with the original entries
    const originals = await inTenant(async () => {
      const repo = ctx.getRepository(GLEntry);
      return repo.find({ where: { referenceDocId: refId2, isReversal: false } });
    });

    await expect(
      inTenant(() =>
        postingService.cancel(originals, {
          companyId,
          postingDate: new Date('2026-07-02'),
          referenceDoctype: refDoctype,
          referenceDocId: refId2,
        }),
      ),
    ).rejects.toThrow(/already been reversed/i);
  });
});
