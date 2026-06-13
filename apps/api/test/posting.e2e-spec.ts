import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource, MoreThanOrEqual, LessThanOrEqual } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Tenant } from '../src/entities/tenant.entity';
import { TenantSchemaService } from '../src/tenant/tenant-schema.service';
import { TenantContextService } from '../src/tenant/tenant-context.service';
import { PostingService, PostingInput } from '../src/accounting/posting.service';
import { GLEntry } from '../src/entities/gl-entry.entity';
import { Company } from '../src/entities/company.entity';
import { Account, AccountType } from '../src/entities/account.entity';
import { FiscalYear } from '../src/entities/fiscal-year.entity';
import { Currency } from '../src/entities/currency.entity';
import { ExchangeRate } from '../src/entities/exchange-rate.entity';

describe('PostingService (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let schemaService: TenantSchemaService;
  let ctx: TenantContextService;
  let postingService: PostingService;

  const tenant: Partial<Tenant> = {
    id: '00000000-0000-0000-0000-000000000090',
    name: 'Posting Test Tenant',
    domain: 'posting-test',
    schemaName: 't_posting_test',
    isActive: true,
  };

  let companyId: string;
  let revenueAccountId: string;
  let receivableAccountId: string;
  let expenseAccountId: string;
  let cashAccountId: string;
  let baseCurrency: string;

  const inTenant = <T>(fn: () => Promise<T>): Promise<T> =>
    ctx.runInTenant(tenant.schemaName!, fn);

  const makeInput = (overrides: Partial<PostingInput> = {}): PostingInput => ({
    companyId,
    postingDate: new Date('2026-07-01'),
    referenceDoctype: 'SalesInvoice',
    referenceDocId: '00000000-0000-0000-0000-000000000101',
    lines: [
      { accountId: receivableAccountId, debit: 1000, credit: 0 },
      { accountId: revenueAccountId, debit: 0, credit: 1000 },
    ],
    ...overrides,
  });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    dataSource = app.get<DataSource>(DataSource);
    schemaService = app.get<TenantSchemaService>(TenantSchemaService);
    ctx = app.get<TenantContextService>(TenantContextService);
    postingService = app.get<PostingService>(PostingService);

    const tenantRepo = dataSource.getRepository(Tenant);
    await tenantRepo.upsert(tenant as Tenant, ['domain']);
    await schemaService.provisionSchema(tenant as Tenant);

    // Seed: company + accounts + open fiscal year
    await inTenant(async () => {
      const company = await ctx.getRepository(Company).save(
        ctx.getRepository(Company).create({
          name: 'Posting Test Co',
          baseCurrency: 'SAR',
        }),
      );
      companyId = company.id;
      baseCurrency = company.baseCurrency;

      revenueAccountId = (await ctx.getRepository(Account).save(
        ctx.getRepository(Account).create({
          name: 'Revenue', type: AccountType.INCOME, companyId,
        }),
      )).id;

      receivableAccountId = (await ctx.getRepository(Account).save(
        ctx.getRepository(Account).create({
          name: 'Receivable', type: AccountType.ASSET, companyId,
        }),
      )).id;

      expenseAccountId = (await ctx.getRepository(Account).save(
        ctx.getRepository(Account).create({
          name: 'Expense', type: AccountType.EXPENSE, companyId,
        }),
      )).id;

      cashAccountId = (await ctx.getRepository(Account).save(
        ctx.getRepository(Account).create({
          name: 'Cash', type: AccountType.ASSET, companyId,
        }),
      )).id;

      // Open fiscal year covering 2026
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
    await dataSource.getRepository(Tenant).delete({ domain: 'posting-test' });
    await app.close();
  });

  // ── Happy path ───────────────────────────────────────────
  it('posts a balanced entry and returns GLEntry rows', async () => {
    const entries = await inTenant(() => postingService.post(makeInput()));

    expect(entries).toHaveLength(2);
    const debitEntry = entries.find((e) => Number(e.debit) > 0)!;
    const creditEntry = entries.find((e) => Number(e.credit) > 0)!;

    expect(Number(debitEntry.debit)).toBe(1000);
    expect(Number(debitEntry.credit)).toBe(0);
    expect(Number(debitEntry.baseDebit)).toBe(1000);
    expect(debitEntry.accountId).toBe(receivableAccountId);

    expect(Number(creditEntry.credit)).toBe(1000);
    expect(Number(creditEntry.debit)).toBe(0);
    expect(Number(creditEntry.baseCredit)).toBe(1000);
    expect(creditEntry.accountId).toBe(revenueAccountId);

    expect(debitEntry.referenceDocId).toBe('00000000-0000-0000-0000-000000000101');
    expect(creditEntry.referenceDoctype).toBe('SalesInvoice');
  });

  it('posts a balanced entry with 3+ lines', async () => {
    const entries = await inTenant(() =>
      postingService.post({
        ...makeInput(),
        referenceDocId: '00000000-0000-0000-0000-000000000102',
        lines: [
          { accountId: cashAccountId, debit: 500, credit: 0 },
          { accountId: receivableAccountId, debit: 500, credit: 0 },
          { accountId: revenueAccountId, debit: 0, credit: 1000 },
        ],
      }),
    );

    expect(entries).toHaveLength(3);
    const totalDebit = entries.reduce((s, e) => s + Number(e.baseDebit), 0);
    const totalCredit = entries.reduce((s, e) => s + Number(e.baseCredit), 0);
    expect(totalDebit).toBe(totalCredit);
  });

  // ── Balance enforcement ──────────────────────────────────
  it('rejects an unbalanced entry', async () => {
    await expect(
      inTenant(() =>
        postingService.post({
          ...makeInput(),
          lines: [
            { accountId: receivableAccountId, debit: 1000, credit: 0 },
            { accountId: revenueAccountId, debit: 0, credit: 900 },
          ],
        }),
      ),
    ).rejects.toThrow(/unbalanced/i);
  });

  // ── Line validation ──────────────────────────────────────
  it('rejects a line with both debit and credit', async () => {
    await expect(
      inTenant(() =>
        postingService.post({
          ...makeInput(),
          lines: [
            { accountId: receivableAccountId, debit: 500, credit: 500 },
            { accountId: revenueAccountId, debit: 0, credit: 1000 },
          ],
        }),
      ),
    ).rejects.toThrow(/both debit and credit/i);
  });

  it('rejects a line with zero debit and credit', async () => {
    await expect(
      inTenant(() =>
        postingService.post({
          ...makeInput(),
          lines: [
            { accountId: receivableAccountId, debit: 0, credit: 0 },
            { accountId: revenueAccountId, debit: 0, credit: 1000 },
          ],
        }),
      ),
    ).rejects.toThrow(/either debit or credit/i);
  });

  it('rejects negative amounts', async () => {
    await expect(
      inTenant(() =>
        postingService.post({
          ...makeInput(),
          lines: [
            { accountId: receivableAccountId, debit: -100, credit: 0 },
            { accountId: revenueAccountId, debit: 0, credit: 100 },
          ],
        }),
      ),
    ).rejects.toThrow(/non-negative/i);
  });

  it('rejects posting with no lines', async () => {
    await expect(
      inTenant(() =>
        postingService.post({ ...makeInput(), lines: [] }),
      ),
    ).rejects.toThrow(/at least one/i);
  });

  // ── Non-existent account ─────────────────────────────────
  it('rejects posting with a non-existent account', async () => {
    await expect(
      inTenant(() =>
        postingService.post({
          ...makeInput(),
          lines: [
            { accountId: receivableAccountId, debit: 500, credit: 0 },
            {
              accountId: '00000000-0000-0000-0000-000000009999',
              debit: 0,
              credit: 500,
            },
          ],
        }),
      ),
    ).rejects.toThrow(/account.*not found/i);
  });

  // ── Multi-currency ───────────────────────────────────────
  it('posts a multi-currency entry balanced in base currency', async () => {
    const entries = await inTenant(() =>
      postingService.post({
        ...makeInput(),
        referenceDocId: '00000000-0000-0000-0000-000000000103',
        lines: [
          { accountId: receivableAccountId, debit: 100, credit: 0, currency: 'USD', exchangeRate: 3.75 },
          { accountId: revenueAccountId, debit: 0, credit: 375, currency: 'SAR', exchangeRate: 1 },
        ],
      }),
    );

    expect(entries).toHaveLength(2);
    const usdEntry = entries.find((e) => e.currency === 'USD');
    expect(usdEntry).toBeDefined();
    expect(Number(usdEntry!.debit)).toBe(100);
    expect(Number(usdEntry!.exchangeRate)).toBeCloseTo(3.75, 2);
    expect(Number(usdEntry!.baseDebit)).toBe(375);

    const sarEntry = entries.find((e) => e.currency === 'SAR');
    expect(Number(sarEntry!.baseCredit)).toBe(375);
  });

  // ── Atomic rollback ──────────────────────────────────────
  it('rolls back all entries when one line fails (atomicity)', async () => {
    const refDocId = '00000000-0000-0000-0000-000000000199';

    // Attempt posting with an invalid line
    await expect(
      inTenant(() =>
        postingService.post({
          ...makeInput(),
          referenceDocId: refDocId,
          lines: [
            { accountId: receivableAccountId, debit: 500, credit: 0 },
            { accountId: revenueAccountId, debit: 500, credit: 500 }, // invalid: both sides
          ],
        }),
      ),
    ).rejects.toThrow();

    // Verify no GLEntry rows for this reference were written
    const entries = await inTenant(async () => {
      const repo = ctx.getRepository(GLEntry);
      return repo.find({ where: { referenceDocId: refDocId } });
    });
    expect(entries).toHaveLength(0);
  });

  // ── Closed fiscal period ─────────────────────────────────
  it('rejects posting in a closed fiscal period', async () => {
    // Create a closed fiscal year
    await inTenant(async () => {
      await ctx.getRepository(FiscalYear).save(
        ctx.getRepository(FiscalYear).create({
          name: 'FY 2025',
          companyId,
          startDate: new Date('2025-01-01'),
          endDate: new Date('2025-12-31'),
          isClosed: true,
        }),
      );
    });

    await expect(
      inTenant(() =>
        postingService.post({
          ...makeInput(),
          postingDate: new Date('2025-06-15'),
          referenceDocId: '00000000-0000-0000-0000-000000000104',
        }),
      ),
    ).rejects.toThrow(/closed/i);
  });

  // ── Cancel (exact reversal) ──────────────────────────────
  it('cancel generates exact reversal entries', async () => {
    const refDocId = '00000000-0000-0000-0000-000000000105';

    const original = await inTenant(() =>
      postingService.post({
        ...makeInput(),
        referenceDocId: refDocId,
        lines: [
          { accountId: receivableAccountId, debit: 2000, credit: 0 },
          { accountId: revenueAccountId, debit: 0, credit: 2000 },
        ],
      }),
    );

    const reversal = await inTenant(() =>
      postingService.cancel(original, {
        ...makeInput(),
        referenceDocId: refDocId,
        postingDate: new Date('2026-07-02'),
      }),
    );

    expect(reversal).toHaveLength(2);

    // Reversal should swap debit/credit
    const dr = reversal.find((e) => Number(e.credit) > 0);
    const cr = reversal.find((e) => Number(e.debit) > 0);
    expect(Number(dr!.credit)).toBe(2000);
    expect(dr!.accountId).toBe(receivableAccountId);
    expect(Number(cr!.debit)).toBe(2000);
    expect(cr!.accountId).toBe(revenueAccountId);

    // Net effect: original + reversal = zero
    const allEntries = await inTenant(async () => {
      const repo = ctx.getRepository(GLEntry);
      return repo.find({ where: { referenceDocId: refDocId }, order: { createdAt: 'ASC' } });
    });
    const netDebit = allEntries.reduce((s, e) => s + Number(e.baseDebit), 0);
    const netCredit = allEntries.reduce((s, e) => s + Number(e.baseCredit), 0);
    expect(netDebit).toBe(netCredit);
  });

  // ── Cancel into closed fiscal period (fix #3) ────────────
  it('rejects cancel into a closed fiscal period', async () => {
    const refDocId = '00000000-0000-0000-0000-000000000d06';

    const original = await inTenant(() =>
      postingService.post({
        ...makeInput(),
        referenceDocId: refDocId,
        lines: [
          { accountId: receivableAccountId, debit: 100, credit: 0 },
          { accountId: revenueAccountId, debit: 0, credit: 100 },
        ],
      }),
    );

    // Close the fiscal year
    await inTenant(async () => {
      const fy = await ctx.getRepository(FiscalYear).findOneByOrFail({ companyId, isClosed: false });
      fy.isClosed = true;
      await ctx.getRepository(FiscalYear).save(fy);
    });

    await expect(
      inTenant(() =>
        postingService.cancel(original, {
          ...makeInput(),
          referenceDocId: refDocId,
          postingDate: new Date('2026-07-02'),
        }),
      ),
    ).rejects.toThrow(/closed/i);

    // Re-open FY 2026 for subsequent tests
    await inTenant(async () => {
      const fy = await ctx.getRepository(FiscalYear).findOneByOrFail({
        companyId, name: 'FY 2026',
      });
      fy.isClosed = false;
      await ctx.getRepository(FiscalYear).save(fy);
    });
  });

  // ── Cancel partial entries (fix #5) ──────────────────────
  it('rejects cancel with unbalanced/partial entries', async () => {
    const refDocId = '00000000-0000-0000-0000-000000000d07';

    const original = await inTenant(() =>
      postingService.post({
        ...makeInput(),
        referenceDocId: refDocId,
        lines: [
          { accountId: receivableAccountId, debit: 500, credit: 0 },
          { accountId: revenueAccountId, debit: 0, credit: 500 },
        ],
      }),
    );

    // Pass only one of the two original entries → reversal will be unbalanced
    const partial = [original[0]];
    await expect(
      inTenant(() =>
        postingService.cancel(partial, {
          ...makeInput(),
          referenceDocId: refDocId,
          postingDate: new Date('2026-07-02'),
        }),
      ),
    ).rejects.toThrow(/unbalanced reversal/i);
  });

  // ── UNIQUE index on reversal_of (fix #4) ──────────────────
  it('UNIQUE index on reversal_of prevents double-reversal at DB level', async () => {
    const refDocId = '00000000-0000-0000-0000-000000000d08';

    const original = await inTenant(() =>
      postingService.post({
        ...makeInput(),
        referenceDocId: refDocId,
        lines: [
          { accountId: receivableAccountId, debit: 200, credit: 0 },
          { accountId: revenueAccountId, debit: 0, credit: 200 },
        ],
      }),
    );

    // First cancel
    await inTenant(() =>
      postingService.cancel(original, {
        ...makeInput(),
        referenceDocId: refDocId,
        postingDate: new Date('2026-07-02'),
      }),
    );

    // Second cancel should fail due to UNIQUE index (count check + DB constraint)
    await expect(
      inTenant(() =>
        postingService.cancel(original, {
          ...makeInput(),
          referenceDocId: refDocId,
          postingDate: new Date('2026-07-02'),
        }),
      ),
    ).rejects.toThrow(/already been reversed/i);
  });

  // ── FX rate lookup (gap #1) ──────────────────────────────
  // A foreign-currency line with no explicit exchangeRate must be valued from
  // the exchange_rates table, not silently defaulted to 1:1.
  it('looks up the exchange rate for a foreign-currency line missing an explicit rate', async () => {
    // Seed USD currency + a rate valid before the posting date.
    await inTenant(async () => {
      const usd = await ctx.getRepository(Currency).save(
        ctx.getRepository(Currency).create({ code: 'USD', name: 'US Dollar', symbol: '$' }),
      );
      await ctx.getRepository(ExchangeRate).save(
        ctx.getRepository(ExchangeRate).create({
          currencyId: usd.id,
          rate: 3.75,
          validFrom: new Date('2026-01-01'),
        }),
      );
    });

    const entries = await inTenant(() =>
      postingService.post({
        ...makeInput(),
        referenceDocId: '00000000-0000-0000-0000-000000000201',
        lines: [
          // No exchangeRate supplied → must resolve to 3.75 from exchange_rates.
          { accountId: receivableAccountId, debit: 100, credit: 0, currency: 'USD' },
          { accountId: revenueAccountId, debit: 0, credit: 375 },
        ],
      }),
    );

    const usdEntry = entries.find((e) => e.currency === 'USD')!;
    expect(usdEntry).toBeDefined();
    expect(Number(usdEntry.exchangeRate)).toBeCloseTo(3.75, 2);
    expect(Number(usdEntry.baseDebit)).toBe(375);
  });

  it('rejects a foreign-currency line when no exchange rate can be found', async () => {
    await expect(
      inTenant(() =>
        postingService.post({
          ...makeInput(),
          referenceDocId: '00000000-0000-0000-0000-000000000202',
          lines: [
            { accountId: receivableAccountId, debit: 100, credit: 0, currency: 'EUR' },
            { accountId: revenueAccountId, debit: 0, credit: 100 },
          ],
        }),
      ),
    ).rejects.toThrow(/no exchange rate found for eur/i);
  });

  // ── Missing fiscal period (gap #2) ───────────────────────
  it('rejects posting on a date no fiscal period covers', async () => {
    await expect(
      inTenant(() =>
        postingService.post({
          ...makeInput(),
          postingDate: new Date('2099-01-01'),
          referenceDocId: '00000000-0000-0000-0000-000000000203',
        }),
      ),
    ).rejects.toThrow(/no open fiscal period/i);
  });

  // ── Group (non-postable) account (gap #3) ────────────────
  it('rejects posting to a group account', async () => {
    const groupAccountId = await inTenant(
      async () =>
        (
          await ctx.getRepository(Account).save(
            ctx.getRepository(Account).create({
              name: 'Assets (Group)',
              type: AccountType.ASSET,
              companyId,
              isGroup: true,
            }),
          )
        ).id,
    );

    await expect(
      inTenant(() =>
        postingService.post({
          ...makeInput(),
          referenceDocId: '00000000-0000-0000-0000-000000000204',
          lines: [
            { accountId: groupAccountId, debit: 100, credit: 0 },
            { accountId: revenueAccountId, debit: 0, credit: 100 },
          ],
        }),
      ),
    ).rejects.toThrow(/group account/i);
  });

  // ── Cross-company account reference (gap #4) ─────────────
  it('rejects an entry referencing an account from another company', async () => {
    // A second company in the same tenant, with its own open fiscal period.
    const otherCompanyId = await inTenant(async () => {
      const otherCompany = await ctx.getRepository(Company).save(
        ctx.getRepository(Company).create({ name: 'Other Co', baseCurrency: 'SAR' }),
      );
      await ctx.getRepository(FiscalYear).save(
        ctx.getRepository(FiscalYear).create({
          name: 'Other FY 2026',
          companyId: otherCompany.id,
          startDate: new Date('2026-01-01'),
          endDate: new Date('2026-12-31'),
          isClosed: false,
        }),
      );
      return otherCompany.id;
    });

    await expect(
      inTenant(() =>
        postingService.post({
          ...makeInput(),
          companyId: otherCompanyId,
          referenceDocId: '00000000-0000-0000-0000-000000000205',
          // accounts below belong to the original company, not otherCompanyId
          lines: [
            { accountId: receivableAccountId, debit: 100, credit: 0 },
            { accountId: revenueAccountId, debit: 0, credit: 100 },
          ],
        }),
      ),
    ).rejects.toThrow(/does not belong to company/i);
  });

  // ── Tenant isolation ─────────────────────────────────────
  describe('Tenant isolation', () => {
    let otherSchema: string;

    beforeAll(async () => {
      otherSchema = 't_posting_iso_test';
      const otherTenant: Partial<Tenant> = {
        id: '00000000-0000-0000-0000-000000000091',
        name: 'Posting Isolation Tenant',
        domain: 'posting-isolation-test',
        schemaName: otherSchema,
        isActive: true,
      };
      const repo = dataSource.getRepository(Tenant);
      await repo.upsert(otherTenant as Tenant, ['domain']);
      await schemaService.provisionSchema(otherTenant as Tenant);
    });

    afterAll(async () => {
      await schemaService.dropSchema({ schemaName: otherSchema } as Tenant).catch(() => {});
      await dataSource.getRepository(Tenant).delete({ domain: 'posting-isolation-test' }).catch(() => {});
    });

    it('does not leak gl_entries across tenant schemas', async () => {
      const otherEntries = await ctx.runInTenant(otherSchema, async () => {
        const repo = ctx.getRepository(GLEntry);
        return repo.find();
      });
      expect(otherEntries).toHaveLength(0);
    });
  });
});
