import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { Tenant } from '../src/entities/tenant.entity';
import { TenantSchemaService } from '../src/tenant/tenant-schema.service';
import { DoctypeService } from '../src/doctype/doctype.service';

describe('Generic Masters CRUD (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let schemaService: TenantSchemaService;
  let doctypeService: DoctypeService;

  const tenant: Partial<Tenant> = {
    id: '00000000-0000-0000-0000-000000000071',
    name: 'Resource Test Tenant',
    domain: 'resource-test',
    schemaName: 't_resource_test',
    isActive: true,
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    dataSource = app.get<DataSource>(DataSource);
    schemaService = app.get<TenantSchemaService>(TenantSchemaService);
    doctypeService = app.get<DoctypeService>(DoctypeService);

    const tenantRepo = dataSource.getRepository(Tenant);
    await tenantRepo.upsert(tenant as Tenant, ['domain']);
    await schemaService.provisionSchema(tenant as Tenant);
    await dataSource.query(`SET search_path TO "${tenant.schemaName}"`);

    await doctypeService.register('Item', 'Item', [
      { fieldname: 'item_code', label: 'Item Code', fieldtype: 'Data', isMandatory: true },
      { fieldname: 'item_name', label: 'Item Name', fieldtype: 'Data', isMandatory: true },
      { fieldname: 'rate', label: 'Rate', fieldtype: 'Currency' },
    ]);

    await doctypeService.register('Customer', 'Customer', [
      { fieldname: 'customer_name', label: 'Customer Name', fieldtype: 'Data', isMandatory: true },
    ]);
  });

  afterAll(async () => {
    await dataSource.query('SET search_path TO public');
    await schemaService.dropSchema(tenant as Tenant).catch(() => {});
    await dataSource.getRepository(Tenant).delete({ domain: 'resource-test' });
    await app.close();
  });

  let itemId: string;

  it('POST /api/resource/:doctype creates a document', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/resource/Item')
      .set('x-tenant', tenant.domain!)
      .send({ item_code: 'ITM-001', item_name: 'Widget', rate: 100 })
      .expect(201);

    expect(res.body).toHaveProperty('id');
    expect(res.body.data.item_code).toBe('ITM-001');
    expect(res.body.data.rate).toBe(100);
    itemId = res.body.id;
  });

  it('GET /api/resource/:doctype lists documents', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/resource/Item')
      .set('x-tenant', tenant.domain!)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(1);
    expect(res.body[0].data.item_code).toBe('ITM-001');
  });

  it('GET /api/resource/:doctype/:id returns one document', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/resource/Item/${itemId}`)
      .set('x-tenant', tenant.domain!)
      .expect(200);

    expect(res.body.id).toBe(itemId);
    expect(res.body.data.item_name).toBe('Widget');
  });

  it('GET /api/resource/:doctype/:id returns 404 for unknown id', async () => {
    await request(app.getHttpServer())
      .get('/api/resource/Item/00000000-0000-0000-0000-000000009999')
      .set('x-tenant', tenant.domain!)
      .expect(404);
  });

  it('PUT /api/resource/:doctype/:id updates a document', async () => {
    const res = await request(app.getHttpServer())
      .put(`/api/resource/Item/${itemId}`)
      .set('x-tenant', tenant.domain!)
      .send({ rate: 150 })
      .expect(200);

    expect(res.body.data.rate).toBe(150);
    expect(res.body.data.item_code).toBe('ITM-001');
  });

  it('POST /api/resource/:doctype works for another doctype without custom code', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/resource/Customer')
      .set('x-tenant', tenant.domain!)
      .send({ customer_name: 'Acme Corp' })
      .expect(201);

    expect(res.body.data.customer_name).toBe('Acme Corp');
  });

  it('POST /api/resource/:doctype returns 404 for unknown doctype', async () => {
    await request(app.getHttpServer())
      .post('/api/resource/NonExistent')
      .set('x-tenant', tenant.domain!)
      .send({ name: 'test' })
      .expect(404);
  });
});
