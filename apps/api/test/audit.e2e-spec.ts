import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { Tenant } from '../src/entities/tenant.entity';
import { TenantSchemaService } from '../src/tenant/tenant-schema.service';
import { TenantContextService } from '../src/tenant/tenant-context.service';
import { DoctypeService } from '../src/doctype/doctype.service';
import { Doctype } from '../src/entities/doctype.entity';
import { DocVersion } from '../src/entities/doc-version.entity';
import { ActivityLog } from '../src/entities/activity-log.entity';
import { Comment } from '../src/entities/comment.entity';
import { DataDocument } from '../src/entities/data-document.entity';
import { Role } from '../src/entities/role.entity';
import { Permission } from '../src/entities/permission.entity';
import { User, UserRole } from '../src/entities/user.entity';
import { AuditService } from '../src/audit/audit.service';
import * as argon2 from 'argon2';

describe('Audit trail (T0.32–T0.33)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let schemaService: TenantSchemaService;
  let ctx: TenantContextService;
  let doctypeService: DoctypeService;
  let auditService: AuditService;

  const tenant: Partial<Tenant> = {
    id: '00000000-0000-0000-0000-000000000032',
    name: 'Audit Test',
    domain: 'audit-test',
    schemaName: 't_audit_test',
    isActive: true,
  };

  let trackedDoctypeId: string;
  let untrackedDoctypeId: string;
  let jwtToken: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    dataSource = app.get(DataSource);
    schemaService = app.get(TenantSchemaService);
    ctx = app.get(TenantContextService);
    doctypeService = app.get(DoctypeService);
    auditService = app.get(AuditService);

    await dataSource.getRepository(Tenant).upsert(tenant as Tenant, ['domain']);
    await schemaService.provisionSchema(tenant as Tenant);

    await ctx.runInTenant(tenant.schemaName!, async () => {
      // Create user
      await ctx.getRepository(User).save({
        email: 'audit@test.com',
        name: 'Audit User',
        passwordHash: await argon2.hash('AuditPass1'),
        role: UserRole.ADMIN,
      });

      // Create admin role
      await ctx.getRepository(Role).save({ name: 'admin', description: 'Admin role' });

      // Register tracked doctype (tracking = 'Full')
      const tracked = await doctypeService.register('TrackedDoc', 'Tracked Document', []);
      trackedDoctypeId = tracked.id;
      // Enable tracking
      tracked.tracking = 'Full';
      await ctx.getRepository(Doctype).save(tracked);

      // Register untracked doctype (tracking = 'None' — default)
      const untracked = await doctypeService.register('UntrackedDoc', 'Untracked Document', []);
      untrackedDoctypeId = untracked.id;

      // Grant permissions
      const role = await ctx.getRepository(Role).findOneOrFail({ where: { name: 'admin' } });
      await ctx.getRepository(Permission).save([
        { roleId: role.id, doctypeId: trackedDoctypeId, create: true, read: true, update: true },
        { roleId: role.id, doctypeId: untrackedDoctypeId, create: true, read: true, update: true },
      ]);
    });
  });

  afterAll(async () => {
    await schemaService.dropSchema(tenant as Tenant).catch(() => {});
    await dataSource.getRepository(Tenant).delete({ domain: 'audit-test' });
    await app.close();
  });

  const login = async (): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('x-tenant', tenant.domain!)
      .send({ email: 'audit@test.com', password: 'AuditPass1' })
      .expect(201);
    return res.body.access_token;
  };

  // ── Tracked doctype: versions created on insert and update ────
  it('creates DocVersion on insert for tracked doctype', async () => {
    jwtToken = await login();

    const res = await request(app.getHttpServer())
      .post('/api/resource/TrackedDoc')
      .set('x-tenant', tenant.domain!)
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ title: 'Version 1', amount: 100 })
      .expect(201);

    const docId = res.body.id;

    const versions = await ctx.runInTenant(tenant.schemaName!, () =>
      auditService.getVersions(trackedDoctypeId, docId),
    );
    expect(versions).toHaveLength(1);
    expect(versions[0].versionNumber).toBe(1);
    expect(versions[0].oldData).toBeNull();
    expect(versions[0].newData).toEqual({ title: 'Version 1', amount: 100 });

    const logs = await ctx.runInTenant(tenant.schemaName!, () =>
      auditService.getActivityLog(trackedDoctypeId, docId),
    );
    expect(logs).toHaveLength(1);
    expect(logs[0].activityType).toBe('Create');
  });

  it('creates another DocVersion on update for tracked doctype', async () => {
    // Create a doc first
    const created = await request(app.getHttpServer())
      .post('/api/resource/TrackedDoc')
      .set('x-tenant', tenant.domain!)
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ title: 'To Update', value: 50 })
      .expect(201);

    const docId = created.body.id;

    await request(app.getHttpServer())
      .put(`/api/resource/TrackedDoc/${docId}`)
      .set('x-tenant', tenant.domain!)
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ title: 'Updated Title' })
      .expect(200);

    const versions = await ctx.runInTenant(tenant.schemaName!, () =>
      auditService.getVersions(trackedDoctypeId, docId),
    );
    expect(versions).toHaveLength(2);
    // Version 1: insert
    expect(versions[0].versionNumber).toBe(1);
    expect(versions[0].oldData).toBeNull();
    // Version 2: update
    expect(versions[1].versionNumber).toBe(2);
    expect(versions[1].oldData).toMatchObject({ title: 'To Update', value: 50 });

    const logs = await ctx.runInTenant(tenant.schemaName!, () =>
      auditService.getActivityLog(trackedDoctypeId, docId),
    );
    expect(logs).toHaveLength(2);
    expect(logs[1].activityType).toBe('Update');
  });

  // ── Untracked doctype: no versions ────────────────
  it('does NOT create DocVersion for untracked doctype', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/resource/UntrackedDoc')
      .set('x-tenant', tenant.domain!)
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ title: 'No tracking' })
      .expect(201);

    const versions = await ctx.runInTenant(tenant.schemaName!, () =>
      auditService.getVersions(untrackedDoctypeId, res.body.id),
    );
    expect(versions).toHaveLength(0);
  });

  // ── Comment ───────────────────────────────────────
  it('stores and retrieves comments', async () => {
    const comments = await ctx.runInTenant(tenant.schemaName!, () =>
      auditService.addComment(trackedDoctypeId, '00000000-0000-0000-0000-000000000c01', 'Test comment'),
    );
    expect(comments.content).toBe('Test comment');

    const retrieved = await ctx.runInTenant(tenant.schemaName!, () =>
      auditService.getComments(trackedDoctypeId, '00000000-0000-0000-0000-000000000c01'),
    );
    expect(retrieved).toHaveLength(1);
    expect(retrieved[0].content).toBe('Test comment');
  });

  // ── Activity log is append-only ───────────────────
  it('activity log is append-only and entries survive', async () => {
    const docId = '00000000-0000-0000-0000-000000000c02';

    await ctx.runInTenant(tenant.schemaName!, () =>
      auditService.logActivity(trackedDoctypeId, docId, 'Submit', 'Doc submitted'),
    );
    await ctx.runInTenant(tenant.schemaName!, () =>
      auditService.logActivity(trackedDoctypeId, docId, 'Approve', 'Doc approved'),
    );

    const logs = await ctx.runInTenant(tenant.schemaName!, () =>
      auditService.getActivityLog(trackedDoctypeId, docId),
    );
    expect(logs).toHaveLength(2);
    expect(logs[0].activityType).toBe('Submit');
    expect(logs[1].activityType).toBe('Approve');
  });

  // ── Survival test: versions/logs outlive the document ──
  it('versions and logs survive document deletion', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/resource/TrackedDoc')
      .set('x-tenant', tenant.domain!)
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ title: 'Delete me', amount: 999 })
      .expect(201);

    const docId = res.body.id;

    // Confirm audit trail exists before deletion
    const versionsBefore = await ctx.runInTenant(tenant.schemaName!, () =>
      auditService.getVersions(trackedDoctypeId, docId),
    );
    expect(versionsBefore.length).toBeGreaterThanOrEqual(1);

    // Delete the document row directly
    await ctx.runInTenant(tenant.schemaName!, async () => {
      await ctx.getRepository(DataDocument).delete(docId);
    });

    // Verify audit trail still exists after document deletion
    const versionsAfter = await ctx.runInTenant(tenant.schemaName!, () =>
      auditService.getVersions(trackedDoctypeId, docId),
    );
    expect(versionsAfter.length).toBeGreaterThanOrEqual(1);

    const logsAfter = await ctx.runInTenant(tenant.schemaName!, () =>
      auditService.getActivityLog(trackedDoctypeId, docId),
    );
    expect(logsAfter.length).toBeGreaterThanOrEqual(1);
  });

  // ── DocVersion uses system stamps ─────────────────
  it('DocVersion has created_by set', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/resource/TrackedDoc')
      .set('x-tenant', tenant.domain!)
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ title: 'Stamp check' })
      .expect(201);

    const versions = await ctx.runInTenant(tenant.schemaName!, () =>
      auditService.getVersions(trackedDoctypeId, res.body.id),
    );
    expect(versions).toHaveLength(1);
    // created_by should be set by the system subscriber
    expect(versions[0].createdBy).toBeTruthy();
  });
});
