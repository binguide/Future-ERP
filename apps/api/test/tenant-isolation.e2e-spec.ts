import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, Controller, Get, Req } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { Tenant } from '../src/entities/tenant.entity';
import { TenantContextService } from '../src/tenant/tenant-context.service';

@Controller('test')
class TestController {
  constructor(private readonly ctx: TenantContextService) {}

  // Query via the request-scoped context manager so current_schema() reflects
  // the connection the middleware pinned (this is what exercises search_path).
  @Get('current-schema')
  async currentSchema() {
    const result = await this.ctx.manager.query('SELECT current_schema()');
    return { schema: result[0].current_schema };
  }

  @Get('tenant')
  tenantInfo(@Req() req: any) {
    return {
      domain: req.tenant?.domain ?? null,
      schema: req.tenantSchema ?? null,
    };
  }
}

describe('Tenant isolation (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [TestController],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    dataSource = app.get<DataSource>(DataSource);

    const tenantRepo = dataSource.getRepository(Tenant);

    await tenantRepo.upsert(
      {
        id: '00000000-0000-0000-0000-000000000001',
        name: 'Test Tenant Alpha',
        domain: 'alpha',
        schemaName: 'tenant_alpha',
        isActive: true,
      },
      ['domain'],
    );
    await tenantRepo.upsert(
      {
        id: '00000000-0000-0000-0000-000000000002',
        name: 'Test Tenant Beta',
        domain: 'beta',
        schemaName: 'tenant_beta',
        isActive: true,
      },
      ['domain'],
    );

    await dataSource.query('CREATE SCHEMA IF NOT EXISTS tenant_alpha');
    await dataSource.query('CREATE SCHEMA IF NOT EXISTS tenant_beta');
  });

  afterAll(async () => {
    try {
      await dataSource.query('DROP SCHEMA IF EXISTS tenant_alpha CASCADE');
      await dataSource.query('DROP SCHEMA IF EXISTS tenant_beta CASCADE');
    } catch {}
    try {
      await dataSource.getRepository(Tenant).delete({ domain: 'alpha' });
      await dataSource.getRepository(Tenant).delete({ domain: 'beta' });
    } catch {}
    await app.close();
  });

  describe('TenantMiddleware resolution', () => {
    it('attaches tenant info for known X-Tenant header', () => {
      return request(app.getHttpServer())
        .get('/api/test/tenant')
        .set('X-Tenant', 'alpha')
        .expect(200)
        .expect((res) => {
          expect(res.body.domain).toBe('alpha');
          expect(res.body.schema).toBe('tenant_alpha');
        });
    });

    it('attaches tenant info for a different tenant', () => {
      return request(app.getHttpServer())
        .get('/api/test/tenant')
        .set('X-Tenant', 'beta')
        .expect(200)
        .expect((res) => {
          expect(res.body.domain).toBe('beta');
          expect(res.body.schema).toBe('tenant_beta');
        });
    });

    it('does not attach tenant for unknown header', () => {
      return request(app.getHttpServer())
        .get('/api/test/tenant')
        .set('X-Tenant', 'nonexistent')
        .expect(200)
        .expect((res) => {
          expect(res.body.domain).toBeNull();
          expect(res.body.schema).toBeNull();
        });
    });

    it('does not attach tenant when no header is present', () => {
      return request(app.getHttpServer())
        .get('/api/test/tenant')
        .expect(200)
        .expect((res) => {
          expect(res.body.domain).toBeNull();
          expect(res.body.schema).toBeNull();
        });
    });
  });

  describe('tenant search_path (request-scoped connection)', () => {
    it('sets search_path to tenant_alpha schema', () => {
      return request(app.getHttpServer())
        .get('/api/test/current-schema')
        .set('X-Tenant', 'alpha')
        .expect(200)
        .expect((res) => {
          expect(res.body.schema).toBe('tenant_alpha');
        });
    });

    it('sets search_path to tenant_beta schema', () => {
      return request(app.getHttpServer())
        .get('/api/test/current-schema')
        .set('X-Tenant', 'beta')
        .expect(200)
        .expect((res) => {
          expect(res.body.schema).toBe('tenant_beta');
        });
    });

    it('uses public schema when no tenant header is present', () => {
      return request(app.getHttpServer())
        .get('/api/test/current-schema')
        .expect(200)
        .expect((res) => {
          expect(res.body.schema).toBe('public');
        });
    });
  });
});
