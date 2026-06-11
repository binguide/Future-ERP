import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { Tenant } from '../src/entities/tenant.entity';
import { TenantSchemaService } from '../src/tenant/tenant-schema.service';
import { UserService } from '../src/user/user.service';

describe('Auth guard (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let schemaService: TenantSchemaService;
  let userService: UserService;

  const tenant: Partial<Tenant> = {
    id: '00000000-0000-0000-0000-000000000051',
    name: 'Guard Test Tenant',
    domain: 'guard-test',
    schemaName: 't_guard_test',
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
    userService = app.get<UserService>(UserService);

    const tenantRepo = dataSource.getRepository(Tenant);
    await tenantRepo.upsert(tenant as Tenant, ['domain']);
    await schemaService.provisionSchema(tenant as Tenant);
    await dataSource.query(`SET search_path TO "${tenant.schemaName}"`);
    await userService.create('guard@example.com', 'Guard User', 'GuardPass1');
    await dataSource.query('SET search_path TO public');
  });

  afterAll(async () => {
    await schemaService.dropSchema(tenant as Tenant).catch(() => {});
    await dataSource.getRepository(Tenant).delete({ domain: 'guard-test' });
    await app.close();
  });

  it('GET /api/auth/me is rejected without a token', async () => {
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('x-tenant', tenant.domain!)
      .expect(401);
  });

  it('GET /api/auth/me is accepted with a valid token', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('x-tenant', tenant.domain!)
      .send({ email: 'guard@example.com', password: 'GuardPass1' })
      .expect(201);

    const token = loginRes.body.access_token;

    const res = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('x-tenant', tenant.domain!)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toHaveProperty('sub');
    expect(res.body).toHaveProperty('email', 'guard@example.com');
    expect(res.body).toHaveProperty('tenant', tenant.schemaName);
  });

  it('GET /api/auth/me is rejected with an invalid token', async () => {
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('x-tenant', tenant.domain!)
      .set('Authorization', 'Bearer invalid-token')
      .expect(401);
  });
});
