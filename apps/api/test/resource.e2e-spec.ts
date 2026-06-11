import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { Tenant } from '../src/entities/tenant.entity';
import { Role } from '../src/entities/role.entity';
import { Permission } from '../src/entities/permission.entity';
import { User, UserRole } from '../src/entities/user.entity';
import { UserPermission } from '../src/entities/user-permission.entity';
import { TenantSchemaService } from '../src/tenant/tenant-schema.service';
import { TenantContextService } from '../src/tenant/tenant-context.service';
import { Doctype } from '../src/entities/doctype.entity';
import { DoctypeService } from '../src/doctype/doctype.service';
import { AbilityFactory } from '../src/permissions/ability.factory';
import * as argon2 from 'argon2';

describe('Generic Masters CRUD (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let schemaService: TenantSchemaService;
  let doctypeService: DoctypeService;
  let ctx: TenantContextService;
  let abilityFactory: AbilityFactory;

  const tenant: Partial<Tenant> = {
    id: '00000000-0000-0000-0000-000000000071',
    name: 'Resource Test Tenant',
    domain: 'resource-test',
    schemaName: 't_resource_test',
    isActive: true,
  };

  let jwtToken: string;

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
    ctx = app.get<TenantContextService>(TenantContextService);
    abilityFactory = app.get<AbilityFactory>(AbilityFactory);

    const tenantRepo = dataSource.getRepository(Tenant);
    await tenantRepo.upsert(tenant as Tenant, ['domain']);
    await schemaService.provisionSchema(tenant as Tenant);

    const schema = tenant.schemaName!;

    await ctx.runInTenant(schema, async () => {
      await ctx.getRepository(User).save({
        email: 'admin@res.com',
        name: 'Admin',
        passwordHash: await argon2.hash('secret'),
        role: UserRole.ADMIN,
      });

      await ctx.getRepository(Role).save({ name: 'admin', description: 'Admin role' });

      const item = await doctypeService.register('Item', 'Item', [
        { fieldname: 'item_code', label: 'Item Code', fieldtype: 'Data', isMandatory: true },
        { fieldname: 'item_name', label: 'Item Name', fieldtype: 'Data', isMandatory: true },
        { fieldname: 'rate', label: 'Rate', fieldtype: 'Currency' },
      ]);
      const cust = await doctypeService.register('Customer', 'Customer', [
        { fieldname: 'customer_name', label: 'Customer Name', fieldtype: 'Data', isMandatory: true },
      ]);

      const role = await ctx.getRepository(Role).findOne({ where: { name: 'admin' } });
      await ctx.getRepository(Permission).save([
        { roleId: role!.id, doctypeId: item.id, create: true, read: true, update: true },
        { roleId: role!.id, doctypeId: cust.id, create: true },
      ]);
    });

    // Verify ability works inside tenant context
    await ctx.runInTenant(schema, async () => {
      const ability = await abilityFactory.createForRole('admin');
      expect(ability.can('create', 'Item')).toBe(true);
      expect(ability.can('read', 'Item')).toBe(true);
    });

    // Login to get JWT
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('x-tenant', tenant.domain!)
      .send({ email: 'admin@res.com', password: 'secret' })
      .expect(201);

    jwtToken = loginRes.body.access_token;
  });

  afterAll(async () => {
    await schemaService.dropSchema(tenant as Tenant).catch(() => {});
    await dataSource.getRepository(Tenant).delete({ domain: 'resource-test' });
    await app.close();
  });

  let itemId: string;

  it('POST /api/resource/:doctype creates a document', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/resource/Item')
      .set('x-tenant', tenant.domain!)
      .set('Authorization', `Bearer ${jwtToken}`)
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
      .set('Authorization', `Bearer ${jwtToken}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(1);
    expect(res.body[0].data.item_code).toBe('ITM-001');
  });

  it('GET /api/resource/:doctype/:id returns one document', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/resource/Item/${itemId}`)
      .set('x-tenant', tenant.domain!)
      .set('Authorization', `Bearer ${jwtToken}`)
      .expect(200);

    expect(res.body.id).toBe(itemId);
    expect(res.body.data.item_name).toBe('Widget');
  });

  it('GET /api/resource/:doctype/:id returns 404 for unknown id', async () => {
    await request(app.getHttpServer())
      .get('/api/resource/Item/00000000-0000-0000-0000-000000009999')
      .set('x-tenant', tenant.domain!)
      .set('Authorization', `Bearer ${jwtToken}`)
      .expect(404);
  });

  it('PUT /api/resource/:doctype/:id updates a document', async () => {
    const res = await request(app.getHttpServer())
      .put(`/api/resource/Item/${itemId}`)
      .set('x-tenant', tenant.domain!)
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ rate: 150 })
      .expect(200);

    expect(res.body.data.rate).toBe(150);
    expect(res.body.data.item_code).toBe('ITM-001');
  });

  it('POST /api/resource/:doctype works for another doctype without custom code', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/resource/Customer')
      .set('x-tenant', tenant.domain!)
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ customer_name: 'Acme Corp' })
      .expect(201);

    expect(res.body.data.customer_name).toBe('Acme Corp');
  });

  it('POST /api/resource/:doctype returns 403 for unknown doctype', async () => {
    await request(app.getHttpServer())
      .post('/api/resource/NonExistent')
      .set('x-tenant', tenant.domain!)
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ name: 'test' })
      .expect(403);
  });

  it('GET /api/resource/:doctype returns 403 without permission', async () => {
    await request(app.getHttpServer())
      .get('/api/resource/Customer')
      .set('x-tenant', tenant.domain!)
      .set('Authorization', `Bearer ${jwtToken}`)
      .expect(403);
  });

  describe('Row-level scope filtering', () => {
    let scopedJwtToken: string;
    let scopedItemId: string;
    let excludedItemId: string;

    beforeAll(async () => {
      const schema = tenant.schemaName!;

      await ctx.runInTenant(schema, async () => {
        const itemDoctype = await ctx.getRepository(Doctype).findOne({ where: { name: 'Item' } });

        const scopedUser = await ctx.getRepository(User).save({
          id: '00000000-0000-0000-0000-000000000099',
          email: 'scoped@res.com',
          name: 'Scoped User',
          passwordHash: await argon2.hash('secret'),
          role: UserRole.ADMIN,
        });

        await ctx.getRepository(UserPermission).save({
          userId: scopedUser.id,
          doctypeId: itemDoctype!.id,
          read: true,
          companyId: 'comp-a',
        });
      });

      // Login as scoped user
      const loginRes = await request(app.getHttpServer())
        .post('/api/auth/login')
        .set('x-tenant', tenant.domain!)
        .send({ email: 'scoped@res.com', password: 'secret' })
        .expect(201);

      scopedJwtToken = loginRes.body.access_token;

      // Create scoped items via API as admin
      const res1 = await request(app.getHttpServer())
        .post('/api/resource/Item')
        .set('x-tenant', tenant.domain!)
        .set('Authorization', `Bearer ${jwtToken}`)
        .send({ item_code: 'ITM-002', item_name: 'Scoped Item', company_id: 'comp-a' })
        .expect(201);
      scopedItemId = res1.body.id;

      const res2 = await request(app.getHttpServer())
        .post('/api/resource/Item')
        .set('x-tenant', tenant.domain!)
        .set('Authorization', `Bearer ${jwtToken}`)
        .send({ item_code: 'ITM-003', item_name: 'Excluded Item', company_id: 'comp-b' })
        .expect(201);
      excludedItemId = res2.body.id;
    });

    it('scoped user only sees items matching their company scope', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/resource/Item')
        .set('x-tenant', tenant.domain!)
        .set('Authorization', `Bearer ${scopedJwtToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      expect(res.body[0].data.company_id).toBe('comp-a');
    });

    it('scoped user cannot access items outside their scope', async () => {
      await request(app.getHttpServer())
        .get(`/api/resource/Item/${excludedItemId}`)
        .set('x-tenant', tenant.domain!)
        .set('Authorization', `Bearer ${scopedJwtToken}`)
        .expect(404);
    });

    it('admin can see all items regardless of scope', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/resource/Item')
        .set('x-tenant', tenant.domain!)
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      // Admin sees original 1 + 2 scope-test items = 3
      expect(res.body.length).toBe(3);
    });
  });
});
