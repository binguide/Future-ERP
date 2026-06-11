import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { Tenant } from '../src/entities/tenant.entity';
import { TenantSchemaService } from '../src/tenant/tenant-schema.service';
import { UserService } from '../src/user/user.service';

describe('User + argon2 (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let schemaService: TenantSchemaService;
  let userService: UserService;

  const tenant: Partial<Tenant> = {
    id: '00000000-0000-0000-0000-000000000031',
    name: 'User Test Tenant',
    domain: 'user-test',
    schemaName: 't_user_test',
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
    userService = app.get<UserService>(UserService);

    const tenantRepo = dataSource.getRepository(Tenant);
    await tenantRepo.upsert(tenant as Tenant, ['domain']);

    await schemaService.provisionSchema(tenant as Tenant);
    await dataSource.query(
      `SET search_path TO "${tenant.schemaName}"`,
    );
  });

  afterAll(async () => {
    await dataSource.query('SET search_path TO public');
    await schemaService.dropSchema(tenant as Tenant).catch(() => {});
    await dataSource.getRepository(Tenant).delete({ domain: 'user-test' });
    await app.close();
  });

  it('creates a user with an argon2-hashed password', async () => {
    const user = await userService.create(
      'ali@example.com',
      'Ali Ahmed',
      'MySecret123',
    );
    expect(user).toBeDefined();
    expect(user.email).toBe('ali@example.com');
    expect(user.name).toBe('Ali Ahmed');
    expect(user.passwordHash).not.toBe('MySecret123');
    expect(user.passwordHash).toMatch(/^\$argon2/);
  });

  it('finds user by email', async () => {
    const user = await userService.findByEmail('ali@example.com');
    expect(user).toBeDefined();
    expect(user!.email).toBe('ali@example.com');
  });

  it('returns null for unknown email', async () => {
    const user = await userService.findByEmail('unknown@example.com');
    expect(user).toBeNull();
  });

  it('validates correct password', async () => {
    const user = await userService.validatePassword(
      'ali@example.com',
      'MySecret123',
    );
    expect(user).toBeDefined();
    expect(user!.email).toBe('ali@example.com');
  });

  it('rejects wrong password', async () => {
    const user = await userService.validatePassword(
      'ali@example.com',
      'WrongPassword',
    );
    expect(user).toBeNull();
  });

  it('rejects unknown email', async () => {
    const user = await userService.validatePassword(
      'nobody@example.com',
      'anything',
    );
    expect(user).toBeNull();
  });

  it('password hash is a real argon2 hash (direct verify)', async () => {
    const user = await userService.findByEmail('ali@example.com');
    const valid = await argon2.verify(user!.passwordHash, 'MySecret123');
    expect(valid).toBe(true);

    const invalid = await argon2.verify(user!.passwordHash, 'WrongPassword');
    expect(invalid).toBe(false);
  });

  it('rejects duplicate email', async () => {
    await expect(
      userService.create('ali@example.com', 'Duplicate', 'Pass123'),
    ).rejects.toThrow('Email already exists');
  });
});
