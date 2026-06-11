import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Tenant } from '../src/entities/tenant.entity';
import { TenantSchemaService } from '../src/tenant/tenant-schema.service';
import { TenantContextService } from '../src/tenant/tenant-context.service';
import { GLEntry } from '../src/entities/gl-entry.entity';
import { Company } from '../src/entities/company.entity';
import { Account, AccountType } from '../src/entities/account.entity';

describe('GLEntry (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let schemaService: TenantSchemaService;
  let ctx: TenantContextService;

  const tenant: Partial<Tenant> = {
    id: '00000000-0000-0000-0000-000000000080',
    name: 'GL Entry Test Tenant',
    domain: 'gl-entry-test',
    schemaName: 't_gl_entry_test',
    isActive: true,
  };

  let companyId: string;
  let accountId: string;

  const inTenant = <T>(fn: () => Promise<T>): Promise<T> =>
    ctx.runInTenant(tenant.schemaName!, fn);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    dataSource = app.get<DataSource>(DataSource);
    schemaService = app.get<TenantSchemaService>(TenantSchemaService);
    ctx = app.get<TenantContextService>(TenantContextService);

    const tenantRepo = dataSource.getRepository(Tenant);
    await tenantRepo.upsert(tenant as Tenant, ['domain']);
    await schemaService.provisionSchema(tenant as Tenant);

    // Seed prerequisite: company + account
    await inTenant(async () => {
      const company = await ctx.getRepository(Company).save(
        ctx.getRepository(Company).create({
          name: 'GL Test Co',
          baseCurrency: 'SAR',
        }),
      );
      companyId = company.id;

      const account = await ctx.getRepository(Account).save(
        ctx.getRepository(Account).create({
          name: 'Test Revenue',
          type: AccountType.INCOME,
          companyId,
        }),
      );
      accountId = account.id;
    });
  });

  afterAll(async () => {
    await schemaService.dropSchema(tenant as Tenant).catch(() => {});
    await dataSource.getRepository(Tenant).delete({ domain: 'gl-entry-test' });
    await app.close();
  });

  it('creates a GLEntry with debit', async () => {
    const entry = await inTenant(async () => {
      const repo = ctx.getRepository(GLEntry);
      return repo.save(
        repo.create({
          companyId,
          accountId,
          debit: 1000,
          credit: 0,
          currency: 'SAR',
          exchangeRate: 1,
          baseDebit: 1000,
          baseCredit: 0,
          postingDate: new Date('2026-06-01'),
          referenceDoctype: 'SalesInvoice',
          referenceDocId: '00000000-0000-0000-0000-000000000001',
        }),
      );
    });

    expect(entry).toBeDefined();
    expect(entry.id).toBeDefined();
    expect(Number(entry.debit)).toBe(1000);
    expect(Number(entry.credit)).toBe(0);
    expect(Number(entry.baseDebit)).toBe(1000);
    expect(Number(entry.baseCredit)).toBe(0);
    expect(entry.currency).toBe('SAR');
    expect(entry.referenceDoctype).toBe('SalesInvoice');
  });

  it('creates a GLEntry with credit', async () => {
    const entry = await inTenant(async () => {
      const repo = ctx.getRepository(GLEntry);
      return repo.save(
        repo.create({
          companyId,
          accountId,
          debit: 0,
          credit: 1000,
          currency: 'SAR',
          exchangeRate: 1,
          baseDebit: 0,
          baseCredit: 1000,
          postingDate: new Date('2026-06-01'),
          referenceDoctype: 'SalesInvoice',
          referenceDocId: '00000000-0000-0000-0000-000000000001',
        }),
      );
    });

    expect(Number(entry.credit)).toBe(1000);
  });

  it('rejects entry with both debit and credit non-zero', async () => {
    await expect(
      inTenant(async () => {
        const repo = ctx.getRepository(GLEntry);
        return repo.save(
          repo.create({
            companyId,
            accountId,
            debit: 500,
            credit: 500,
            currency: 'SAR',
            exchangeRate: 1,
            baseDebit: 500,
            baseCredit: 500,
            postingDate: new Date('2026-06-01'),
            referenceDoctype: 'SalesInvoice',
            referenceDocId: '00000000-0000-0000-0000-000000000002',
          }),
        );
      }),
    ).rejects.toThrow();
  });

  it('stores multi-currency entry with exchange rate', async () => {
    const entry = await inTenant(async () => {
      const repo = ctx.getRepository(GLEntry);
      return repo.save(
        repo.create({
          companyId,
          accountId,
          debit: 100,
          credit: 0,
          currency: 'USD',
          exchangeRate: 3.75,
          baseDebit: 375,
          baseCredit: 0,
          postingDate: new Date('2026-06-01'),
          referenceDoctype: 'JournalEntry',
          referenceDocId: '00000000-0000-0000-0000-000000000010',
          description: 'USD receipt converted at 3.75',
        }),
      );
    });

    expect(entry.currency).toBe('USD');
    expect(Number(entry.exchangeRate)).toBeCloseTo(3.75, 2);
    expect(Number(entry.baseDebit)).toBe(375);
    expect(entry.description).toBe('USD receipt converted at 3.75');
  });

  it('stores dimensions (costCenterId, branchId)', async () => {
    const entry = await inTenant(async () => {
      const repo = ctx.getRepository(GLEntry);
      return repo.save(
        repo.create({
          companyId,
          accountId,
          debit: 500,
          credit: 0,
          currency: 'SAR',
          exchangeRate: 1,
          baseDebit: 500,
          baseCredit: 0,
          postingDate: new Date('2026-06-01'),
          referenceDoctype: 'SalesInvoice',
          referenceDocId: '00000000-0000-0000-0000-000000000003',
          costCenterId: '00000000-0000-0000-0000-0000000000c1',
          branchId: '00000000-0000-0000-0000-0000000000b1',
        }),
      );
    });

    expect(entry.costCenterId).toBe('00000000-0000-0000-0000-0000000000c1');
    expect(entry.branchId).toBe('00000000-0000-0000-0000-0000000000b1');
  });

  it('queries entries by reference doctype and doc id', async () => {
    const entries = await inTenant(async () => {
      const repo = ctx.getRepository(GLEntry);
      return repo.find({
        where: {
          referenceDoctype: 'SalesInvoice',
          referenceDocId: '00000000-0000-0000-0000-000000000001',
        },
        order: { createdAt: 'ASC' },
      });
    });

    expect(entries.length).toBe(2);
    expect(Number(entries[0].debit)).toBe(1000);
    expect(Number(entries[1].credit)).toBe(1000);
  });

  it('returns empty for unknown reference', async () => {
    const entries = await inTenant(async () => {
      const repo = ctx.getRepository(GLEntry);
      return repo.find({
        where: {
          referenceDoctype: 'NonExistent',
          referenceDocId: '00000000-0000-0000-0000-000000009999',
        },
      });
    });

    expect(entries).toHaveLength(0);
  });

  it('supports null dimensions', async () => {
    const entry = await inTenant(async () => {
      const repo = ctx.getRepository(GLEntry);
      return repo.save(
        repo.create({
          companyId,
          accountId,
          debit: 200,
          credit: 0,
          currency: 'SAR',
          exchangeRate: 1,
          baseDebit: 200,
          baseCredit: 0,
          postingDate: new Date('2026-06-01'),
          referenceDoctype: 'SalesInvoice',
          referenceDocId: '00000000-0000-0000-0000-000000000004',
        }),
      );
    });

    expect(entry.costCenterId).toBeNull();
    expect(entry.branchId).toBeNull();
    expect(entry.description).toBeNull();
  });

  describe('Tenant isolation', () => {
    let otherSchema: string;

    beforeAll(async () => {
      otherSchema = 't_gl_iso_test';
      const otherTenant: Partial<Tenant> = {
        id: '00000000-0000-0000-0000-000000000081',
        name: 'GL Isolation Tenant',
        domain: 'gl-isolation-test',
        schemaName: otherSchema,
        isActive: true,
      };
      const repo = dataSource.getRepository(Tenant);
      await repo.upsert(otherTenant as Tenant, ['domain']);
      await schemaService.provisionSchema(otherTenant as Tenant);
    });

    afterAll(async () => {
      await schemaService
        .dropSchema({ schemaName: otherSchema } as Tenant)
        .catch(() => {});
      await dataSource
        .getRepository(Tenant)
        .delete({ domain: 'gl-isolation-test' })
        .catch(() => {});
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
