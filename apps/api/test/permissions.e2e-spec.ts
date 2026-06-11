import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Tenant } from '../src/entities/tenant.entity';
import { User } from '../src/entities/user.entity';
import { TenantSchemaService } from '../src/tenant/tenant-schema.service';
import { TenantContextService } from '../src/tenant/tenant-context.service';
import { DoctypeService } from '../src/doctype/doctype.service';
import { PermissionsService } from '../src/permissions/permissions.service';
import { AbilityFactory } from '../src/permissions/ability.factory';

describe('Permission entities (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let schemaService: TenantSchemaService;
  let doctypeService: DoctypeService;
  let permService: PermissionsService;
  let abilityFactory: AbilityFactory;
  let ctx: TenantContextService;

  const tenant: Partial<Tenant> = {
    id: '00000000-0000-0000-0000-000000000081',
    name: 'Perm Test Tenant',
    domain: 'perm-test',
    schemaName: 't_perm_test',
    isActive: true,
  };

  // RBAC tables are tenant-scoped; run service/repo calls in the tenant context.
  const inTenant = <T>(fn: () => Promise<T>): Promise<T> =>
    ctx.runInTenant(tenant.schemaName!, fn);

  let itemDoctypeId: string;
  let salesDoctypeId: string;
  let roleId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    dataSource = app.get<DataSource>(DataSource);
    schemaService = app.get<TenantSchemaService>(TenantSchemaService);
    doctypeService = app.get<DoctypeService>(DoctypeService);
    permService = app.get<PermissionsService>(PermissionsService);
    abilityFactory = app.get<AbilityFactory>(AbilityFactory);
    ctx = app.get<TenantContextService>(TenantContextService);

    const tenantRepo = dataSource.getRepository(Tenant);
    await tenantRepo.upsert(tenant as Tenant, ['domain']);
    await schemaService.provisionSchema(tenant as Tenant);

    await inTenant(async () => {
      const item = await doctypeService.register('Item', 'Item', []);
      const salesInvoice = await doctypeService.register(
        'SalesInvoice',
        'Sales Invoice',
        [],
      );
      itemDoctypeId = item.id;
      salesDoctypeId = salesInvoice.id;
    });
  });

  afterAll(async () => {
    await schemaService.dropSchema(tenant as Tenant).catch(() => {});
    await dataSource.getRepository(Tenant).delete({ domain: 'perm-test' });
    await app.close();
  });

  it('creates a role', async () => {
    const role = await inTenant(() =>
      permService.createRole('Sales Manager', 'Manages sales'),
    );
    expect(role).toBeDefined();
    expect(role.name).toBe('Sales Manager');
    roleId = role.id;
  });

  it('lists roles', async () => {
    const roles = await inTenant(async () => {
      await permService.createRole('Accountant', 'Handles accounting');
      return permService.listRoles();
    });
    expect(roles.length).toBeGreaterThanOrEqual(2);
    expect(roles.map((r) => r.name)).toContain('Sales Manager');
  });

  it('sets role-level permissions on a doctype', async () => {
    const perm = await inTenant(() =>
      permService.setRolePermission(roleId, itemDoctypeId, {
        create: true,
        read: true,
        update: true,
      }),
    );

    expect(perm).toBeDefined();
    expect(perm.roleId).toBe(roleId);
    expect(perm.create).toBe(true);
    expect(perm.read).toBe(true);
    expect(perm.delete).toBe(false);
  });

  it('gets role permissions', async () => {
    const perms = await inTenant(() => permService.getRolePermissions(roleId));
    expect(perms.length).toBe(1);
    expect(perms[0].doctype.name).toBe('Item');
  });

  it('sets user-level permission (overrides role)', async () => {
    const up = await inTenant(async () => {
      const user = await ctx.getRepository(User).save({
        email: 'user@perms.com',
        name: 'Perm User',
        passwordHash: 'x',
      });
      return permService.setUserPermission(user.id, itemDoctypeId, {
        read: true,
        delete: true,
      });
    });
    expect(up).toBeDefined();
    expect(up.read).toBe(true);
    expect(up.delete).toBe(true);
  });

  it('sets approval authority', async () => {
    const aa = await inTenant(() =>
      permService.setApprovalAuthority(roleId, salesDoctypeId, 10000, true),
    );
    expect(aa).toBeDefined();
    expect(aa.valueCeiling).toBe(10000);
    expect(aa.canApprove).toBe(true);
  });

  it('approval authority allows null ceiling (unlimited)', async () => {
    const aa = await inTenant(() =>
      permService.setApprovalAuthority(roleId, itemDoctypeId, null, true),
    );
    expect(aa.valueCeiling).toBeNull();
  });

  it('ability reflects role permissions', async () => {
    const ability = await inTenant(() =>
      abilityFactory.createForRole('Sales Manager'),
    );
    expect(ability.can('create', 'Item')).toBe(true);
    expect(ability.can('read', 'Item')).toBe(true);
    expect(ability.can('update', 'Item')).toBe(true);
    expect(ability.can('delete', 'Item')).toBe(false);
    expect(ability.can('read', 'SalesInvoice')).toBe(false);
  });

  it('ability returns empty for unknown role', async () => {
    const ability = await inTenant(() =>
      abilityFactory.createForRole('Nonexistent Role'),
    );
    expect(ability.can('read', itemDoctypeId)).toBe(false);
  });
});
