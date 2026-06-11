import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Tenant } from '../src/entities/tenant.entity';
import { TenantSchemaService } from '../src/tenant/tenant-schema.service';
import { TenantContextService } from '../src/tenant/tenant-context.service';
import { DoctypeService } from '../src/doctype/doctype.service';

describe('Doctype + DocField (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let schemaService: TenantSchemaService;
  let doctypeService: DoctypeService;
  let ctx: TenantContextService;

  const tenant: Partial<Tenant> = {
    id: '00000000-0000-0000-0000-000000000061',
    name: 'Doctype Test Tenant',
    domain: 'doctype-test',
    schemaName: 't_doctype_test',
    isActive: true,
  };

  // doctypes/docfields are tenant-scoped; run service calls in the tenant context.
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
    doctypeService = app.get<DoctypeService>(DoctypeService);
    ctx = app.get<TenantContextService>(TenantContextService);

    const tenantRepo = dataSource.getRepository(Tenant);
    await tenantRepo.upsert(tenant as Tenant, ['domain']);
    await schemaService.provisionSchema(tenant as Tenant);
  });

  afterAll(async () => {
    await schemaService.dropSchema(tenant as Tenant).catch(() => {});
    await dataSource.getRepository(Tenant).delete({ domain: 'doctype-test' });
    await app.close();
  });

  it('registers a doctype with fields', async () => {
    const doctype = await inTenant(() =>
      doctypeService.register('Item', 'Item', [
        { fieldname: 'item_code', label: 'Item Code', fieldtype: 'Data', isMandatory: true },
        { fieldname: 'item_name', label: 'Item Name', fieldtype: 'Data', isMandatory: true },
        { fieldname: 'item_type', label: 'Item Type', fieldtype: 'Select', options: 'Product\nService' },
        { fieldname: 'is_active', label: 'Active', fieldtype: 'Check', defaultValue: '1' },
      ]),
    );

    expect(doctype).toBeDefined();
    expect(doctype.name).toBe('Item');
    expect(doctype.label).toBe('Item');
    expect(doctype.fields).toHaveLength(4);
    expect(doctype.fields[0].fieldname).toBe('item_code');
  });

  it('rejects duplicate doctype name', async () => {
    await expect(
      inTenant(() => doctypeService.register('Item', 'Duplicate', [])),
    ).rejects.toThrow('already exists');
  });

  it('finds doctype by name with fields', async () => {
    const doctype = await inTenant(() => doctypeService.findByName('Item'));
    expect(doctype).toBeDefined();
    expect(doctype!.name).toBe('Item');
    expect(doctype!.fields).toHaveLength(4);
    expect(doctype!.fields.map((f) => f.fieldname)).toEqual([
      'item_code',
      'item_name',
      'item_type',
      'is_active',
    ]);
  });

  it('returns null for unknown doctype', async () => {
    const doctype = await inTenant(() => doctypeService.findByName('NonExistent'));
    expect(doctype).toBeNull();
  });

  it('lists all doctypes', async () => {
    await inTenant(() =>
      doctypeService.register('Customer', 'Customer', [
        { fieldname: 'customer_name', label: 'Customer Name', fieldtype: 'Data' },
      ]),
    );

    const list = await inTenant(() => doctypeService.list());
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.map((d) => d.name)).toContain('Item');
    expect(list.map((d) => d.name)).toContain('Customer');
  });

  it('getFields returns fields ordered by idx', async () => {
    const fields = await inTenant(() => doctypeService.getFields('Item'));
    expect(fields).toHaveLength(4);
    expect(fields[0].fieldname).toBe('item_code');
    expect(fields[3].fieldname).toBe('is_active');
  });
});
