import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, Controller, Get, Req } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { Tenant } from '../src/entities/tenant.entity';
import { TenantSchemaService } from '../src/tenant/tenant-schema.service';
import { TenantContextService } from '../src/tenant/tenant-context.service';

const TABLE = '_tenant_items';

@Controller('test')
class TestController {
  constructor(private readonly ctx: TenantContextService) {}

  @Get('tenant-items')
  async tenantItems(@Req() req: any) {
    const schema = req.tenantSchema || 'public';
    // UNqualified table name: which rows come back depends entirely on the
    // search_path the middleware pinned for this request — the isolation under test.
    const result = await this.ctx.manager.query(
      `SELECT * FROM "${TABLE}" ORDER BY name`,
    );
    return { schema, items: result };
  }
}

describe('Tenant data isolation (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let schemaService: TenantSchemaService;

  const tenantA: Partial<Tenant> = {
    id: '00000000-0000-0000-0000-000000000021',
    name: 'Isolation Test A',
    domain: 'iso-a',
    schemaName: 't_iso_a',
    isActive: true,
  };

  const tenantB: Partial<Tenant> = {
    id: '00000000-0000-0000-0000-000000000022',
    name: 'Isolation Test B',
    domain: 'iso-b',
    schemaName: 't_iso_b',
    isActive: true,
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [TestController],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    dataSource = app.get<DataSource>(DataSource);
    schemaService = app.get<TenantSchemaService>(TenantSchemaService);

    const tenantRepo = dataSource.getRepository(Tenant);
    await tenantRepo.upsert(tenantA as Tenant, ['domain']);
    await tenantRepo.upsert(tenantB as Tenant, ['domain']);

    await schemaService.provisionSchema(tenantA as Tenant);
    await schemaService.provisionSchema(tenantB as Tenant);

    const aSchema = tenantA.schemaName!;
    const bSchema = tenantB.schemaName!;

    await dataSource.query(`
      CREATE TABLE IF NOT EXISTS "${aSchema}"."${TABLE}" (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL
      )
    `);
    await dataSource.query(`
      CREATE TABLE IF NOT EXISTS "${bSchema}"."${TABLE}" (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL
      )
    `);

    await dataSource.query(
      `INSERT INTO "${aSchema}"."${TABLE}" (name) VALUES ('Alpha Item A1'), ('Alpha Item A2')`,
    );
    await dataSource.query(
      `INSERT INTO "${bSchema}"."${TABLE}" (name) VALUES ('Beta Item B1'), ('Beta Item B2'), ('Beta Item B3')`,
    );
  });

  afterAll(async () => {
    const tenantRepo = dataSource.getRepository(Tenant);
    await schemaService.dropSchema(tenantA as Tenant).catch(() => {});
    await schemaService.dropSchema(tenantB as Tenant).catch(() => {});
    await tenantRepo.delete({ domain: 'iso-a' });
    await tenantRepo.delete({ domain: 'iso-b' });
    await app.close();
  });

  it('tenant A sees only its own items', () => {
    return request(app.getHttpServer())
      .get('/api/test/tenant-items')
      .set('X-Tenant', 'iso-a')
      .expect(200)
      .expect((res) => {
        expect(res.body.schema).toBe('t_iso_a');
        expect(res.body.items).toHaveLength(2);
        expect(res.body.items[0].name).toMatch(/^Alpha/);
      });
  });

  it('tenant B sees only its own items', () => {
    return request(app.getHttpServer())
      .get('/api/test/tenant-items')
      .set('X-Tenant', 'iso-b')
      .expect(200)
      .expect((res) => {
        expect(res.body.schema).toBe('t_iso_b');
        expect(res.body.items).toHaveLength(3);
        expect(res.body.items[0].name).toMatch(/^Beta/);
      });
  });

  it('tenant A cannot read tenant B items using search_path', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/test/tenant-items')
      .set('X-Tenant', 'iso-a');
    expect(res.body.schema).toBe('t_iso_a');
    const names = res.body.items.map((i: any) => i.name);
    expect(names).not.toContain('Beta Item B1');
    expect(names).not.toContain('Beta Item B2');
    expect(names).not.toContain('Beta Item B3');
  });

  it('tenant B cannot read tenant A items using search_path', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/test/tenant-items')
      .set('X-Tenant', 'iso-b');
    expect(res.body.schema).toBe('t_iso_b');
    const names = res.body.items.map((i: any) => i.name);
    expect(names).not.toContain('Alpha Item A1');
    expect(names).not.toContain('Alpha Item A2');
  });

  it('request without tenant header fails to find the table (public has none)', () => {
    return request(app.getHttpServer())
      .get('/api/test/tenant-items')
      .expect(500);
  });

  it('two simultaneous tenants return different data', async () => {
    const [resA, resB] = await Promise.all([
      request(app.getHttpServer())
        .get('/api/test/tenant-items')
        .set('X-Tenant', 'iso-a'),
      request(app.getHttpServer())
        .get('/api/test/tenant-items')
        .set('X-Tenant', 'iso-b'),
    ]);
    expect(resA.body.items).toHaveLength(2);
    expect(resB.body.items).toHaveLength(3);
    expect(resA.body.items[0].name).toMatch(/^Alpha/);
    expect(resB.body.items[0].name).toMatch(/^Beta/);
  });
});
