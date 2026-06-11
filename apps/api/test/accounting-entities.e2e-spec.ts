import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Tenant } from '../src/entities/tenant.entity';
import { TenantSchemaService } from '../src/tenant/tenant-schema.service';
import { TenantContextService } from '../src/tenant/tenant-context.service';
import { Company } from '../src/entities/company.entity';
import { Branch } from '../src/entities/branch.entity';
import { Currency } from '../src/entities/currency.entity';
import { ExchangeRate } from '../src/entities/exchange-rate.entity';
import { FiscalYear } from '../src/entities/fiscal-year.entity';
import { CostCenter } from '../src/entities/cost-center.entity';
import { Account, AccountType } from '../src/entities/account.entity';

describe('Accounting Entities (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let schemaService: TenantSchemaService;
  let ctx: TenantContextService;

  const tenant: Partial<Tenant> = {
    id: '00000000-0000-0000-0000-000000000070',
    name: 'Accounting Entities Test Tenant',
    domain: 'accounting-entities-test',
    schemaName: 't_acct_entities_test',
    isActive: true,
  };

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
  });

  afterAll(async () => {
    await schemaService.dropSchema(tenant as Tenant).catch(() => {});
    await dataSource.getRepository(Tenant).delete({ domain: 'accounting-entities-test' });
    await app.close();
  });

  // ── Company ──────────────────────────────────────────────
  describe('Company', () => {
    const payload = {
      name: 'Acme Corp',
      baseCurrency: 'SAR',
      defaultValuationMethod: 'Moving Average',
      allowNegativeStock: false,
    };

    it('creates a company', async () => {
      const company = await inTenant(async () => {
        const repo = ctx.getRepository(Company);
        return repo.save(repo.create(payload));
      });
      expect(company).toBeDefined();
      expect(company.id).toBeDefined();
      expect(company.name).toBe('Acme Corp');
      expect(company.baseCurrency).toBe('SAR');
      expect(company.defaultValuationMethod).toBe('Moving Average');
      expect(company.allowNegativeStock).toBe(false);
    });

    it('rejects duplicate company name', async () => {
      await expect(
        inTenant(async () => {
          const repo = ctx.getRepository(Company);
          return repo.save(repo.create(payload));
        }),
      ).rejects.toThrow(/duplicate key|unique/i);
    });

    it('finds company by name', async () => {
      const company = await inTenant(async () => {
        const repo = ctx.getRepository(Company);
        return repo.findOneBy({ name: 'Acme Corp' });
      });
      expect(company).toBeDefined();
      expect(company!.baseCurrency).toBe('SAR');
    });

    it('updates a company', async () => {
      const company = await inTenant(async () => {
        const repo = ctx.getRepository(Company);
        const c = await repo.findOneByOrFail({ name: 'Acme Corp' });
        c.allowNegativeStock = true;
        return repo.save(c);
      });
      expect(company.allowNegativeStock).toBe(true);
    });

    it('deletes a company', async () => {
      await inTenant(async () => {
        const repo = ctx.getRepository(Company);
        const c = await repo.save(repo.create({ ...payload, name: 'Temp Co' }));
        await repo.delete(c.id);
        const found = await repo.findOneBy({ name: 'Temp Co' });
        expect(found).toBeNull();
      });
    });
  });

  // ── Branch ───────────────────────────────────────────────
  describe('Branch', () => {
    let companyId: string;

    beforeAll(async () => {
      companyId = await inTenant(async () => {
        const repo = ctx.getRepository(Company);
        const c = await repo.findOneByOrFail({ name: 'Acme Corp' });
        return c.id;
      });
    });

    it('creates a branch linked to company', async () => {
      const branch = await inTenant(async () => {
        const repo = ctx.getRepository(Branch);
        return repo.save(repo.create({ name: 'Head Office', companyId }));
      });
      expect(branch).toBeDefined();
      expect(branch.id).toBeDefined();
      expect(branch.companyId).toBe(companyId);
    });

    it('fails to create branch with non-existent company', async () => {
      await expect(
        inTenant(async () => {
          const repo = ctx.getRepository(Branch);
          return repo.save(
            repo.create({ name: 'Ghost Branch', companyId: '00000000-0000-0000-0000-000000000099' }),
          );
        }),
      ).rejects.toThrow(/foreign key|violates foreign/i);
    });
  });

  // ── Currency ─────────────────────────────────────────────
  describe('Currency', () => {
    it('creates a currency', async () => {
      const currency = await inTenant(async () => {
        const repo = ctx.getRepository(Currency);
        return repo.save(repo.create({ code: 'SAR', name: 'Saudi Riyal', symbol: '﷼' }));
      });
      expect(currency).toBeDefined();
      expect(currency.code).toBe('SAR');
    });

    it('rejects duplicate currency code', async () => {
      await expect(
        inTenant(async () => {
          const repo = ctx.getRepository(Currency);
          return repo.save(repo.create({ code: 'SAR', name: 'Duplicate', symbol: '﷼' }));
        }),
      ).rejects.toThrow(/duplicate key|unique/i);
    });
  });

  // ── ExchangeRate ─────────────────────────────────────────
  describe('ExchangeRate', () => {
    let currencyId: string;

    beforeAll(async () => {
      currencyId = await inTenant(async () => {
        const repo = ctx.getRepository(Currency);
        const c = await repo.findOneByOrFail({ code: 'SAR' });
        return c.id;
      });
    });

    it('creates an exchange rate', async () => {
      const rate = await inTenant(async () => {
        const repo = ctx.getRepository(ExchangeRate);
        return repo.save(repo.create({ currencyId, rate: 1.0, validFrom: new Date('2026-01-01') }));
      });
      expect(rate).toBeDefined();
      expect(Number(rate.rate)).toBe(1);
    });

    it('stores decimal rate with precision', async () => {
      const rate = await inTenant(async () => {
        const repo = ctx.getRepository(ExchangeRate);
        return repo.save(repo.create({ currencyId, rate: 3.751234, validFrom: new Date('2026-06-01') }));
      });
      expect(Number(rate.rate)).toBeCloseTo(3.751234, 6);
    });
  });

  // ── FiscalYear ───────────────────────────────────────────
  describe('FiscalYear', () => {
    let companyId: string;

    beforeAll(async () => {
      companyId = await inTenant(async () => {
        const repo = ctx.getRepository(Company);
        const c = await repo.findOneByOrFail({ name: 'Acme Corp' });
        return c.id;
      });
    });

    it('creates a fiscal year', async () => {
      const fy = await inTenant(async () => {
        const repo = ctx.getRepository(FiscalYear);
        return repo.save(
          repo.create({
            name: 'FY 2026',
            companyId,
            startDate: new Date('2026-01-01'),
            endDate: new Date('2026-12-31'),
          }),
        );
      });
      expect(fy).toBeDefined();
      expect(fy.name).toBe('FY 2026');
      expect(fy.isClosed).toBe(false);
    });
  });

  // ── CostCenter ───────────────────────────────────────────
  describe('CostCenter', () => {
    let companyId: string;

    beforeAll(async () => {
      companyId = await inTenant(async () => {
        const repo = ctx.getRepository(Company);
        const c = await repo.findOneByOrFail({ name: 'Acme Corp' });
        return c.id;
      });
    });

    it('creates a cost center linked to company', async () => {
      const cc = await inTenant(async () => {
        const repo = ctx.getRepository(CostCenter);
        return repo.save(repo.create({ name: 'Marketing', companyId }));
      });
      expect(cc).toBeDefined();
      expect(cc.companyId).toBe(companyId);
    });

    it('creates a global cost center (no company)', async () => {
      const cc = await inTenant(async () => {
        const repo = ctx.getRepository(CostCenter);
        return repo.save(repo.create({ name: 'Global Overhead' }));
      });
      expect(cc).toBeDefined();
      expect(cc.companyId).toBeNull();
    });
  });

  // ── Account (chart of accounts) ─────────────────────────
  describe('Account', () => {
    let companyId: string;

    beforeAll(async () => {
      companyId = await inTenant(async () => {
        const repo = ctx.getRepository(Company);
        const c = await repo.findOneByOrFail({ name: 'Acme Corp' });
        return c.id;
      });
    });

    it('creates a root account', async () => {
      const acc = await inTenant(async () => {
        const repo = ctx.getRepository(Account);
        return repo.save(
          repo.create({
            name: 'Assets',
            type: AccountType.ASSET,
            isGroup: true,
            companyId,
          }),
        );
      });
      expect(acc).toBeDefined();
      expect(acc.type).toBe(AccountType.ASSET);
      expect(acc.isGroup).toBe(true);
      expect(acc.parentId).toBeNull();
    });

    it('creates a child account referencing a parent', async () => {
      const parent = await inTenant(async () => {
        const repo = ctx.getRepository(Account);
        return repo.findOneByOrFail({ name: 'Assets', companyId });
      });
      const child = await inTenant(async () => {
        const repo = ctx.getRepository(Account);
        return repo.save(
          repo.create({
            name: 'Current Assets',
            type: AccountType.ASSET,
            isGroup: true,
            companyId,
            parentId: parent.id,
          }),
        );
      });
      expect(child.parentId).toBe(parent.id);
    });

    it('creates a leaf account with account number', async () => {
      const parent = await inTenant(async () => {
        const repo = ctx.getRepository(Account);
        return repo.findOneByOrFail({ name: 'Current Assets', companyId });
      });
      const leaf = await inTenant(async () => {
        const repo = ctx.getRepository(Account);
        return repo.save(
          repo.create({
            name: 'Cash',
            accountNumber: '1001',
            type: AccountType.ASSET,
            isGroup: false,
            companyId,
            parentId: parent.id,
          }),
        );
      });
      expect(leaf.accountNumber).toBe('1001');
      expect(leaf.isGroup).toBe(false);
    });

    it('enforces unique company+account_number constraint', async () => {
      await expect(
        inTenant(async () => {
          const repo = ctx.getRepository(Account);
          return repo.save(
            repo.create({
              name: 'Cash Duplicate',
              accountNumber: '1001',
              type: AccountType.ASSET,
              isGroup: false,
              companyId,
            }),
          );
        }),
      ).rejects.toThrow();
    });

    it('lists accounts with parent relation', async () => {
      const accounts = await inTenant(async () => {
        const repo = ctx.getRepository(Account);
        return repo.find({ relations: { parent: true }, order: { createdAt: 'ASC' } });
      });
      expect(accounts.length).toBeGreaterThanOrEqual(3);
      const parentAcc = accounts.find((a) => a.name === 'Current Assets');
      expect(parentAcc!.parent).toBeDefined();
      expect(parentAcc!.parent!.name).toBe('Assets');
    });
  });

  // ── Tenant isolation ─────────────────────────────────────
  describe('Tenant isolation', () => {
    let otherSchema: string;

    beforeAll(async () => {
      otherSchema = 't_acct_iso_test';
      const otherTenant: Partial<Tenant> = {
        id: '00000000-0000-0000-0000-000000000072',
        name: 'Isolation Test Tenant',
        domain: 'acct-isolation-test',
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
        .delete({ domain: 'acct-isolation-test' })
        .catch(() => {});
    });

    it('does not leak companies across tenant schemas', async () => {
      const otherCompanies = await ctx.runInTenant(otherSchema, async () => {
        const repo = ctx.getRepository(Company);
        return repo.find();
      });
      expect(otherCompanies).toHaveLength(0);
    });

    it('does not leak accounts across tenant schemas', async () => {
      const otherAccounts = await ctx.runInTenant(otherSchema, async () => {
        const repo = ctx.getRepository(Account);
        return repo.find();
      });
      expect(otherAccounts).toHaveLength(0);
    });
  });
});
