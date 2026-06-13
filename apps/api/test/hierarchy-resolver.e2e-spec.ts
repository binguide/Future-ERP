import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Tenant } from '../src/entities/tenant.entity';
import { TenantSchemaService } from '../src/tenant/tenant-schema.service';
import { TenantContextService } from '../src/tenant/tenant-context.service';
import { HierarchyResolverService } from '../src/common/hierarchy-resolver.service';
import { Company } from '../src/entities/company.entity';

describe('HierarchyResolver (T0.26–T0.27)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let schemaService: TenantSchemaService;
  let ctx: TenantContextService;
  let resolver: HierarchyResolverService;

  const tenant: Partial<Tenant> = {
    id: '00000000-0000-0000-0000-000000000e01',
    name: 'Hierarchy Test',
    domain: 'hierarchy-test',
    schemaName: 't_hierarchy',
    isActive: true,
  };

  let companyId: string;

  const inTenant = <T>(fn: () => Promise<T>): Promise<T> =>
    ctx.runInTenant(tenant.schemaName!, fn);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    dataSource = app.get(DataSource);
    schemaService = app.get(TenantSchemaService);
    ctx = app.get(TenantContextService);
    resolver = app.get(HierarchyResolverService);

    await dataSource.getRepository(Tenant).upsert(tenant as Tenant, ['domain']);
    await schemaService.provisionSchema(tenant as Tenant);

    await inTenant(async () => {
      const company = await ctx.getRepository(Company).save(
        ctx.getRepository(Company).create({
          name: 'Hierarchy Co',
          baseCurrency: 'SAR',
          defaultValuationMethod: 'Moving Average',
        }),
      );
      companyId = company.id;
    });
  });

  afterAll(async () => {
    await schemaService.dropSchema(tenant as Tenant).catch(() => {});
    await dataSource.getRepository(Tenant).delete({ domain: 'hierarchy-test' });
    await app.close();
  });

  // ── Item→ItemGroup→Company variant ─────────────────────

  it('returns the most-specific value when all levels are set', async () => {
    const result = await resolver.resolve<string>([
      async () => 'FIFO',                    // item level
      async () => 'Moving Average',           // item_group level
      () => inTenant(() =>                    // company level
        ctx.getRepository(Company).findOneByOrFail({ id: companyId })
          .then((c) => c.defaultValuationMethod),
      ),
    ]);
    expect(result).toBe('FIFO');
  });

  it('falls back to the middle level when the first is empty', async () => {
    const result = await resolver.resolve<string>([
      async () => null,                        // item level — empty
      async () => 'Moving Average',            // item_group level — has value
      () => inTenant(() =>                     // company level
        ctx.getRepository(Company).findOneByOrFail({ id: companyId })
          .then((c) => c.defaultValuationMethod),
      ),
    ]);
    expect(result).toBe('Moving Average');
  });

  it('falls back to company default when higher levels are empty', async () => {
    const result = await resolver.resolve<string>([
      async () => null,                        // item level — empty
      async () => null,                        // item_group level — empty
      () => inTenant(() =>                     // company level
        ctx.getRepository(Company).findOneByOrFail({ id: companyId })
          .then((c) => c.defaultValuationMethod),
      ),
    ]);
    expect(result).toBe('Moving Average');
  });

  it('returns null when no level has a value', async () => {
    const result = await resolver.resolve<string>([
      async () => null,
      async () => null,
      async () => null,
    ]);
    expect(result).toBeNull();
  });

  // ── Item→Warehouse→Company variant (same logic, different step order) ──

  it('Item→Warehouse→Company: most-specific warehouse value wins', async () => {
    const result = await resolver.resolve<boolean>([
      async () => false,      // item level — allow negative stock = false
      async () => true,       // warehouse level — allow negative stock = true
      async () => false,      // company level — allow negative stock = false
    ]);
    expect(result).toBe(false); // item (most specific) wins
  });

  it('Item→Warehouse→Company: falls back to warehouse when item is empty', async () => {
    const result = await resolver.resolve<boolean>([
      async () => null,       // item level — empty
      async () => true,       // warehouse level — allow negative stock = true
      async () => false,      // company level — allow negative stock = false
    ]);
    expect(result).toBe(true); // warehouse wins
  });

  it('Item→Warehouse→Company: falls back to company when both item and warehouse empty', async () => {
    const result = await resolver.resolve<boolean>([
      async () => null,       // item level — empty
      async () => null,       // warehouse level — empty
      async () => false,      // company level — default is false
    ]);
    expect(result).toBe(false); // company wins
  });
});
