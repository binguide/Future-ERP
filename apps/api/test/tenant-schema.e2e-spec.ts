import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Tenant } from '../src/entities/tenant.entity';
import { TenantSchemaService } from '../src/tenant/tenant-schema.service';

describe('Tenant schema provisioning (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let schemaService: TenantSchemaService;

  const alphaTenant: Partial<Tenant> = {
    id: '00000000-0000-0000-0000-000000000011',
    name: 'Schema Test Alpha',
    domain: 'schema-alpha',
    schemaName: 't_schema_alpha',
    isActive: true,
  };

  const betaTenant: Partial<Tenant> = {
    id: '00000000-0000-0000-0000-000000000012',
    name: 'Schema Test Beta',
    domain: 'schema-beta',
    schemaName: 't_schema_beta',
    isActive: true,
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    dataSource = app.get<DataSource>(DataSource);
    schemaService = app.get<TenantSchemaService>(TenantSchemaService);

    const tenantRepo = dataSource.getRepository(Tenant);
    await tenantRepo.upsert(alphaTenant as Tenant, ['domain']);
    await tenantRepo.upsert(betaTenant as Tenant, ['domain']);
  });

  afterAll(async () => {
    const tenantRepo = dataSource.getRepository(Tenant);
    await schemaService.dropSchema(alphaTenant as Tenant).catch(() => {});
    await schemaService.dropSchema(betaTenant as Tenant).catch(() => {});
    await tenantRepo.delete({ domain: 'schema-alpha' });
    await tenantRepo.delete({ domain: 'schema-beta' });
    await app.close();
  });

  it('schema does not exist before provisioning', async () => {
    const exists = await schemaService.schemaExists('t_schema_alpha');
    expect(exists).toBe(false);
  });

  it('provisionSchema creates the PostgreSQL schema', async () => {
    await schemaService.provisionSchema(alphaTenant as Tenant);
    const exists = await schemaService.schemaExists('t_schema_alpha');
    expect(exists).toBe(true);
  });

  it('second tenant gets its own schema', async () => {
    await schemaService.provisionSchema(betaTenant as Tenant);
    const alphaExists = await schemaService.schemaExists('t_schema_alpha');
    const betaExists = await schemaService.schemaExists('t_schema_beta');
    expect(alphaExists).toBe(true);
    expect(betaExists).toBe(true);
  });

  it('provisionSchema is idempotent', async () => {
    await expect(
      schemaService.provisionSchema(alphaTenant as Tenant),
    ).resolves.toBeUndefined();
    const exists = await schemaService.schemaExists('t_schema_alpha');
    expect(exists).toBe(true);
  });

  it('creates the schema with the correct name', async () => {
    const result = await dataSource.query(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1`,
      ['t_schema_beta'],
    );
    expect(result.length).toBe(1);
    expect(result[0].schema_name).toBe('t_schema_beta');
  });

  it('dropSchema removes the schema', async () => {
    await schemaService.dropSchema(alphaTenant as Tenant);
    const exists = await schemaService.schemaExists('t_schema_alpha');
    expect(exists).toBe(false);
  });

  it('dropSchema is idempotent', async () => {
    await expect(
      schemaService.dropSchema(alphaTenant as Tenant),
    ).resolves.toBeUndefined();
  });
});
