import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Tenant } from '../src/entities/tenant.entity';
import { TenantSchemaService } from '../src/tenant/tenant-schema.service';
import { TenantContextService } from '../src/tenant/tenant-context.service';
import { PostingLine, PostingService } from '../src/accounting/posting.service';
import { GLEntry } from '../src/entities/gl-entry.entity';
import { Company } from '../src/entities/company.entity';
import { Account, AccountType } from '../src/entities/account.entity';
import { FiscalYear } from '../src/entities/fiscal-year.entity';

describe('PostingService integer cents (T0.22e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let schemaService: TenantSchemaService;
  let ctx: TenantContextService;
  let postingService: PostingService;

  const tenant: Partial<Tenant> = {
    id: '00000000-0000-0000-0000-0000000000e0',
    name: 'Integer Cents Test',
    domain: 'integer-cents-test',
    schemaName: 't_int_cents',
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

    await dataSource.getRepository(Tenant).upsert(tenant as Tenant, ['domain']);
    await schemaService.provisionSchema(tenant as Tenant);

    await inTenant(async () => {
      const company = await ctx.getRepository(Company).save(
        ctx.getRepository(Company).create({ name: 'Cents Co', baseCurrency: 'SAR' }),
      );
      companyId = company.id;

      assetAcctId = (
        await ctx.getRepository(Account).save(
          ctx.getRepository(Account).create({ name: 'Cents Asset', type: AccountType.ASSET, companyId }),
        )
      ).id;

      incomeAcctId = (
        await ctx.getRepository(Account).save(
          ctx.getRepository(Account).create({ name: 'Cents Income', type: AccountType.INCOME, companyId }),
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
    await dataSource.getRepository(Tenant).delete({ domain: 'integer-cents-test' });
    await app.close();
  });

  it('accumulates many small values without float drift (integer cents)', async () => {
    const refDocId = '00000000-0000-0000-0000-000000000e01';

    // 100 lines of 0.07 SAR debit → 7.00 SAR total
    const lines: PostingLine[] = [];
    for (let i = 0; i < 100; i++) {
      lines.push({ accountId: assetAcctId, debit: 0.07, credit: 0 });
    }
    lines.push({ accountId: incomeAcctId, debit: 0, credit: 7 });

    const entries = await inTenant(() =>
      postingService.post({
        companyId,
        postingDate: new Date('2026-07-01'),
        referenceDoctype: 'Test',
        referenceDocId: refDocId,
        lines,
      }),
    );

    // Should produce 101 rows
    expect(entries).toHaveLength(101);

    // Sum baseDebit and baseCredit in cents (integer arithmetic)
    const totalBaseDebitCents = Math.round(
      entries.reduce((s, e) => s + Number(e.baseDebit), 0) * 100,
    );
    const totalBaseCreditCents = Math.round(
      entries.reduce((s, e) => s + Number(e.baseCredit), 0) * 100,
    );
    expect(totalBaseDebitCents).toBe(totalBaseCreditCents);
    expect(totalBaseDebitCents).toBe(700); // 7.00
  });

  it('posts sub-cent exchange-rate conversions exactly in base currency', async () => {
    const refDocId = '00000000-0000-0000-0000-000000000e02';

    // 100 USD @ 3.751234 (non-round rate)
    // debit 100 USD → base = Math.round(10000 * 3.751234) / 100 = 37512 / 100 = 375.12
    const entries = await inTenant(() =>
      postingService.post({
        companyId,
        postingDate: new Date('2026-07-01'),
        referenceDoctype: 'Test',
        referenceDocId: refDocId,
        lines: [
          { accountId: assetAcctId, debit: 100, credit: 0, currency: 'USD', exchangeRate: 3.751234 },
          { accountId: incomeAcctId, debit: 0, credit: 375.1234 },
        ],
      }),
    );

    const usdEntry = entries.find((e) => e.currency === 'USD')!;
    expect(Number(usdEntry.baseDebit)).toBe(375.12);
    expect(Number(entries.find((e) => e.currency !== 'USD')!.baseCredit)).toBe(375.12);
  });

  it('stores debit/credit as 2-decimal values (integer cents boundary)', async () => {
    const refDocId = '00000000-0000-0000-0000-000000000e03';

    const entries = await inTenant(() =>
      postingService.post({
        companyId,
        postingDate: new Date('2026-07-01'),
        referenceDoctype: 'Test',
        referenceDocId: refDocId,
        lines: [
          { accountId: assetAcctId, debit: 0.1, credit: 0 },
          { accountId: assetAcctId, debit: 0.2, credit: 0 },
          { accountId: incomeAcctId, debit: 0, credit: 0.3 },
        ],
      }),
    );

    expect(entries).toHaveLength(3);
    const totalDebitCents = Math.round(entries.reduce((s, e) => s + Number(e.baseDebit), 0) * 100);
    const totalCreditCents = Math.round(entries.reduce((s, e) => s + Number(e.baseCredit), 0) * 100);
    expect(totalDebitCents).toBe(totalCreditCents);
    expect(totalDebitCents).toBe(30);
  });
});
