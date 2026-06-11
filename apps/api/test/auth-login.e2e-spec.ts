import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { Tenant } from '../src/entities/tenant.entity';
import { TenantSchemaService } from '../src/tenant/tenant-schema.service';
import { UserService } from '../src/user/user.service';
import { JwtService } from '@nestjs/jwt';

describe('Auth login (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let schemaService: TenantSchemaService;
  let userService: UserService;
  let jwtService: JwtService;

  const tenant: Partial<Tenant> = {
    id: '00000000-0000-0000-0000-000000000041',
    name: 'Auth Test Tenant',
    domain: 'auth-test',
    schemaName: 't_auth_test',
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
    jwtService = app.get<JwtService>(JwtService);

    const tenantRepo = dataSource.getRepository(Tenant);
    await tenantRepo.upsert(tenant as Tenant, ['domain']);
    await schemaService.provisionSchema(tenant as Tenant);
    await dataSource.query(`SET search_path TO "${tenant.schemaName}"`);

    await userService.create('ahmed@example.com', 'Ahmed', 'SecurePass1');
  });

  afterAll(async () => {
    await dataSource.query('SET search_path TO public');
    await schemaService.dropSchema(tenant as Tenant).catch(() => {});
    await dataSource.getRepository(Tenant).delete({ domain: 'auth-test' });
    await app.close();
  });

  it('POST /api/auth/login returns a JWT with valid credentials', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('x-tenant', tenant.domain!)
      .send({ email: 'ahmed@example.com', password: 'SecurePass1' })
      .expect(201);

    expect(res.body).toHaveProperty('access_token');
    expect(typeof res.body.access_token).toBe('string');

    const payload = jwtService.decode(res.body.access_token) as any;
    expect(payload).toHaveProperty('sub');
    expect(payload).toHaveProperty('email', 'ahmed@example.com');
    expect(payload).toHaveProperty('tenant', tenant.schemaName);
  });

  it('POST /api/auth/login rejects wrong password', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('x-tenant', tenant.domain!)
      .send({ email: 'ahmed@example.com', password: 'WrongPassword' })
      .expect(401);
  });

  it('POST /api/auth/login rejects unknown email', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('x-tenant', tenant.domain!)
      .send({ email: 'nobody@example.com', password: 'anything' })
      .expect(401);
  });

  it('POST /api/auth/login rejects missing credentials', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('x-tenant', tenant.domain!)
      .send({})
      .expect(401);
  });
});
