import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Tenant } from '../src/entities/tenant.entity';
import { TenantSchemaService } from '../src/tenant/tenant-schema.service';
import { TenantContextService } from '../src/tenant/tenant-context.service';
import { Account, AccountType } from '../src/entities/account.entity';
import { GLEntry } from '../src/entities/gl-entry.entity';
import { Company } from '../src/entities/company.entity';

describe('GLEntry description TEXT (T0.18b)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let schemaService: TenantSchemaService;
  let ctx: TenantContextService;

  const tenant: Partial<Tenant> = {
    id: '00000000-0000-0000-0000-0000000000b1',
    name: 'Text Description Test',
    domain: 'description-text-test',
    schemaName: 't_desc_text',
    isActive: true,
  };

  const inTenant = <T>(fn: () => Promise<T>): Promise<T> =>
    ctx.runInTenant(tenant.schemaName!, fn);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    dataSource = app.get(DataSource);
    schemaService = app.get(TenantSchemaService);
    ctx = app.get(TenantContextService);

    await dataSource.getRepository(Tenant).upsert(tenant as Tenant, ['domain']);
    await schemaService.provisionSchema(tenant as Tenant);
  });

  afterAll(async () => {
    await schemaService.dropSchema(tenant as Tenant).catch(() => {});
    await dataSource.getRepository(Tenant).delete({ domain: 'description-text-test' });
    await app.close();
  });

  it('stores and reads a description longer than 255 characters (TEXT column)', async () => {
    const longDesc = 'A'.repeat(500);

    const company = await inTenant(async () => {
      const repo = ctx.getRepository(Company);
      return repo.save(repo.create({ name: 'Text Desc Co', baseCurrency: 'SAR' }));
    });
    const account = await inTenant(async () => {
      const repo = ctx.getRepository(Account);
      return repo.save(
        repo.create({ name: 'Text Desc Acct', type: AccountType.ASSET, companyId: company.id }),
      );
    });

    const entry = await inTenant(async () => {
      const repo = ctx.getRepository(GLEntry);
      return repo.save(
        repo.create({
          companyId: company.id,
          accountId: account.id,
          debit: 100,
          credit: 0,
          currency: 'SAR',
          exchangeRate: 1,
          baseDebit: 100,
          baseCredit: 0,
          postingDate: new Date('2026-06-01'),
          referenceDoctype: 'Test',
          referenceDocId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          description: longDesc,
        }),
      );
    });

    expect(entry.description).toBe(longDesc);

    const read = await inTenant(async () => {
      const repo = ctx.getRepository(GLEntry);
      return repo.findOneByOrFail({ id: entry.id });
    });
    expect(read.description).toBe(longDesc);
    expect(read.description!.length).toBe(500);
  });

  it('stores a null description', async () => {
    const company = await inTenant(async () => {
      const repo = ctx.getRepository(Company);
      return repo.save(repo.create({ name: 'Null Desc Co', baseCurrency: 'SAR' }));
    });
    const account = await inTenant(async () => {
      const repo = ctx.getRepository(Account);
      return repo.save(
        repo.create({ name: 'Null Desc Acct', type: AccountType.ASSET, companyId: company.id }),
      );
    });

    const entry = await inTenant(async () => {
      const repo = ctx.getRepository(GLEntry);
      return repo.save(
        repo.create({
          companyId: company.id,
          accountId: account.id,
          debit: 200,
          credit: 0,
          currency: 'SAR',
          exchangeRate: 1,
          baseDebit: 200,
          baseCredit: 0,
          postingDate: new Date('2026-06-01'),
          referenceDoctype: 'Test',
          referenceDocId: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff',
        }),
      );
    });

    expect(entry.description).toBeNull();
  });
});
