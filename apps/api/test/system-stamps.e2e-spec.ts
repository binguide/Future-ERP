import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { Tenant } from '../src/entities/tenant.entity';
import { TenantSchemaService } from '../src/tenant/tenant-schema.service';
import { TenantContextService } from '../src/tenant/tenant-context.service';
import { UserService } from '../src/user/user.service';
import { JwtService } from '@nestjs/jwt';
import { Doctype } from '../src/entities/doctype.entity';
import { DataDocument } from '../src/entities/data-document.entity';
import { Role } from '../src/entities/role.entity';
import { Permission } from '../src/entities/permission.entity';

describe('System stamps (T0.31)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let schemaService: TenantSchemaService;
  let ctx: TenantContextService;
  let userService: UserService;

  const tenant: Partial<Tenant> = {
    id: '00000000-0000-0000-0000-000000000031',
    name: 'System Stamp Test',
    domain: 'stamp-test',
    schemaName: 't_stamp_test',
    isActive: true,
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    dataSource = app.get(DataSource);
    schemaService = app.get(TenantSchemaService);
    ctx = app.get(TenantContextService);
    userService = app.get(UserService);

    const tenantRepo = dataSource.getRepository(Tenant);
    await tenantRepo.upsert(tenant as Tenant, ['domain']);
    await schemaService.provisionSchema(tenant as Tenant);

    // Create a doctype, role with permissions, and a user for authenticated tests
    await ctx.runInTenant(tenant.schemaName!, async () => {
      const doctype = await ctx.getRepository(Doctype).save(
        ctx.getRepository(Doctype).create({
          name: 'StampTestDoc',
          label: 'Stamp Test Document',
        }),
      );

      await ctx.getRepository(Role).save(
        ctx.getRepository(Role).create({
          name: 'user',
          description: 'Default user role',
        }),
      );

      const role = await ctx.getRepository(Role).findOneOrFail({ where: { name: 'user' } });
      await ctx.getRepository(Permission).save(
        ctx.getRepository(Permission).create({
          roleId: role.id,
          doctypeId: doctype.id,
          create: true,
          read: true,
          update: true,
        }),
      );

      await userService.create('stamp@test.com', 'Stamp User', 'StampPass1');
    });
  });

  afterAll(async () => {
    await schemaService.dropSchema(tenant as Tenant).catch(() => {});
    await dataSource.getRepository(Tenant).delete({ domain: 'stamp-test' });
    await app.close();
  });

  const login = async (): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('x-tenant', tenant.domain!)
      .send({ email: 'stamp@test.com', password: 'StampPass1' })
      .expect(201);
    return res.body.access_token;
  };

  // ── createdBy is set on authenticated insert ──────────
  it('sets created_by and modified_by on authenticated insert', async () => {
    const token = await login();

    const res = await request(app.getHttpServer())
      .post('/api/resource/StampTestDoc')
      .set('x-tenant', tenant.domain!)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Stamp Test' })
      .expect(201);

    expect(res.body).toHaveProperty('id');
    expect(res.body.createdBy).toBeTruthy();
    expect(res.body.modifiedBy).toBe(res.body.createdBy);

    // Verify in DB
    const doc = await ctx.runInTenant(tenant.schemaName!, async () => {
      return ctx.getRepository(DataDocument).findOneByOrFail({ id: res.body.id });
    });
    expect(doc.createdBy).toBe(res.body.createdBy);
    expect(doc.modifiedBy).toBe(res.body.createdBy);
  });

  // ── modifiedBy updates on authenticated update ─────────
  it('updates modified_by on authenticated update', async () => {
    const token = await login();
    const jwtService = app.get(JwtService);
    const payload = jwtService.decode(token) as any;
    const userId = payload.sub;

    // Create a doc
    const created = await request(app.getHttpServer())
      .post('/api/resource/StampTestDoc')
      .set('x-tenant', tenant.domain!)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Update Stamp Test' })
      .expect(201);

    expect(created.body.createdBy).toBe(userId);

    // Update it
    const updated = await request(app.getHttpServer())
      .put(`/api/resource/StampTestDoc/${created.body.id}`)
      .set('x-tenant', tenant.domain!)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Updated' })
      .expect(200);

    expect(updated.body.modifiedBy).toBe(userId);
  });

  // ── Unauthenticated insert leaves stamps null ─────────
  it('leaves created_by null on unauthenticated insert', async () => {
    const res = await ctx.runInTenant(tenant.schemaName!, async () => {
      const doctype = await ctx.getRepository(Doctype).findOneByOrFail({ name: 'StampTestDoc' });
      const doc = ctx.getRepository(DataDocument).create({
        doctype,
        data: { title: 'No Auth' },
      });
      return ctx.getRepository(DataDocument).save(doc);
    });

    expect(res.createdBy).toBeNull();
    expect(res.modifiedBy).toBeNull();
  });
});
