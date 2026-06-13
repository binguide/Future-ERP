import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Tenant } from '../src/entities/tenant.entity';
import { TenantSchemaService } from '../src/tenant/tenant-schema.service';
import { TenantContextService } from '../src/tenant/tenant-context.service';
import { LifecycleService } from '../src/accounting/lifecycle.service';
import { PostingService } from '../src/accounting/posting.service';
import { WorkflowEngineService } from '../src/workflow/workflow-engine.service';
import { Doctype } from '../src/entities/doctype.entity';
import { Workflow } from '../src/entities/workflow.entity';
import { WorkflowState } from '../src/entities/workflow-state.entity';
import { WorkflowTransition } from '../src/entities/workflow-transition.entity';
import { WorkflowAction } from '../src/entities/workflow-action.entity';
import { ApprovalAuthority } from '../src/entities/approval-authority.entity';
import { Role } from '../src/entities/role.entity';
import { User } from '../src/entities/user.entity';
import { TransactionDocument } from '../src/entities/transaction-document.entity';
import { Company } from '../src/entities/company.entity';
import { Account, AccountType } from '../src/entities/account.entity';
import { FiscalYear } from '../src/entities/fiscal-year.entity';
import { GLEntry } from '../src/entities/gl-entry.entity';

describe('Workflow engine (T0.29–T0.30)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let schemaService: TenantSchemaService;
  let ctx: TenantContextService;
  let lifecycleService: LifecycleService;
  let workflowEngine: WorkflowEngineService;

  const tenant: Partial<Tenant> = {
    id: '00000000-0000-0000-0000-000000000140',
    name: 'Workflow Engine Test',
    domain: 'workflow-engine-test',
    schemaName: 't_workflow_engine',
    isActive: true,
  };

  const inTenant = <T>(fn: () => Promise<T>): Promise<T> =>
    ctx.runInTenant(tenant.schemaName!, fn);

  let seq = 0;
  const unique = () => `_we${++seq}`;
  const actorId = '00000000-0000-0000-0000-000000000e01';
  const managerActorId = '00000000-0000-0000-0000-000000000e02';
  const supervisorActorId = '00000000-0000-0000-0000-000000000e03';

  let doctypeId: string;
  let companyId: string;
  let assetAcctId: string;
  let incomeAcctId: string;
  let draftStateId: string;
  let pendingStateId: string;
  let approvedStateId: string;
  let escalatedStateId: string;
  let draftToPendingId: string;
  let pendingToApprovedId: string;
  let pendingToEscalatedId: string;
  let pendingToRejectedId: string;
  let userRoleId: string;
  let managerRoleId: string;
  let noAuthApprovedId: string;
  let noAuthPendingId: string;
  let noAuthDoctypeId: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    dataSource = app.get(DataSource);
    schemaService = app.get(TenantSchemaService);
    ctx = app.get(TenantContextService);
    lifecycleService = app.get(LifecycleService);
    workflowEngine = app.get(WorkflowEngineService);

    const tenantRepo = dataSource.getRepository(Tenant);
    await tenantRepo.upsert(tenant as Tenant, ['domain']);
    await schemaService.provisionSchema(tenant as Tenant);

    await inTenant(async () => {
      const doctype = await ctx.getRepository(Doctype).save(
        ctx.getRepository(Doctype).create({ name: 'WF_Engine_Doc', label: 'Workflow Engine Doc' }),
      );
      doctypeId = doctype.id;

      const userRole = await ctx.getRepository(Role).save(
        ctx.getRepository(Role).create({ name: 'user' }),
      );
      userRoleId = userRole.id;

      const managerRole = await ctx.getRepository(Role).save(
        ctx.getRepository(Role).create({ name: 'manager' }),
      );
      managerRoleId = managerRole.id;

      // Create User records for the test actors
      await ctx.getRepository(User).save(
        ctx.getRepository(User).create({
          id: actorId,
          email: 'we-user@test.com',
          name: 'WE User',
          passwordHash: 'not-used-in-test',
          role: 'user' as any,
        }),
      );
      await ctx.getRepository(User).save(
        ctx.getRepository(User).create({
          id: managerActorId,
          email: 'we-manager@test.com',
          name: 'WE Manager',
          passwordHash: 'not-used-in-test',
          role: 'manager' as any,
        }),
      );

      const workflow = await ctx.getRepository(Workflow).save(
        ctx.getRepository(Workflow).create({
          doctypeId: doctype.id,
          workflowName: 'Engine Test Workflow',
          isActive: true,
        }),
      );

      const draft = await ctx.getRepository(WorkflowState).save(
        ctx.getRepository(WorkflowState).create({
          workflowId: workflow.id,
          stateName: 'Draft',
          docstatus: 0,
          isEditable: true,
          isTerminal: false,
        }),
      );
      draftStateId = draft.id;

      const pending = await ctx.getRepository(WorkflowState).save(
        ctx.getRepository(WorkflowState).create({
          workflowId: workflow.id,
          stateName: 'Pending',
          docstatus: 0,
          isEditable: false,
          isTerminal: false,
        }),
      );
      pendingStateId = pending.id;

      const approved = await ctx.getRepository(WorkflowState).save(
        ctx.getRepository(WorkflowState).create({
          workflowId: workflow.id,
          stateName: 'Approved',
          docstatus: 1,
          isEditable: false,
          isTerminal: true,
        }),
      );
      approvedStateId = approved.id;

      const rejected = await ctx.getRepository(WorkflowState).save(
        ctx.getRepository(WorkflowState).create({
          workflowId: workflow.id,
          stateName: 'Rejected',
          docstatus: 0,
          isEditable: false,
          isTerminal: true,
        }),
      );

      const escalated = await ctx.getRepository(WorkflowState).save(
        ctx.getRepository(WorkflowState).create({
          workflowId: workflow.id,
          stateName: 'Escalated',
          docstatus: 0,
          isEditable: false,
          isTerminal: false,
        }),
      );
      escalatedStateId = escalated.id;

      draftToPendingId = (
        await ctx.getRepository(WorkflowTransition).save(
          ctx.getRepository(WorkflowTransition).create({
            workflowId: workflow.id,
            fromStateId: draft.id,
            toStateId: pending.id,
            roleId: userRole.id,
            sequence: 1,
          }),
        )
      ).id;

      pendingToApprovedId = (
        await ctx.getRepository(WorkflowTransition).save(
          ctx.getRepository(WorkflowTransition).create({
            workflowId: workflow.id,
            fromStateId: pending.id,
            toStateId: approved.id,
            roleId: managerRole.id,
            sequence: 2,
          }),
        )
      ).id;

      pendingToEscalatedId = (
        await ctx.getRepository(WorkflowTransition).save(
          ctx.getRepository(WorkflowTransition).create({
            workflowId: workflow.id,
            fromStateId: pending.id,
            toStateId: escalated.id,
            roleId: managerRole.id,
            sequence: 3,
          }),
        )
      ).id;

      pendingToRejectedId = (
        await ctx.getRepository(WorkflowTransition).save(
          ctx.getRepository(WorkflowTransition).create({
            workflowId: workflow.id,
            fromStateId: pending.id,
            toStateId: rejected.id,
            roleId: managerRole.id,
            action: 'Reject',
            sequence: 4,
          }),
        )
      ).id;

      const supervisorRole = await ctx.getRepository(Role).save(
        ctx.getRepository(Role).create({ name: 'supervisor' }),
      );
      const supervisorRoleId = supervisorRole.id;

      await ctx.getRepository(User).save(
        ctx.getRepository(User).create({
          id: supervisorActorId,
          email: 'we-supervisor@test.com',
          name: 'WE Supervisor',
          passwordHash: 'not-used-in-test',
          role: 'supervisor' as any,
        }),
      );

      // A second escalation target for sequence-ordering tests
      const pendingDirectorState = await ctx.getRepository(WorkflowState).save(
        ctx.getRepository(WorkflowState).create({
          workflowId: workflow.id,
          stateName: 'Pending Director',
          docstatus: 0,
          isEditable: false,
          isTerminal: false,
        }),
      );

      await ctx.getRepository(WorkflowTransition).save(
        ctx.getRepository(WorkflowTransition).create({
          workflowId: workflow.id,
          fromStateId: pending.id,
          toStateId: pendingDirectorState.id,
          roleId: managerRole.id,
          action: 'Approve',
          sequence: 5,
        }),
      );

      // A doctype with a workflow (manager role, no ApprovalAuthority)
      const noAuthDoctype = await ctx.getRepository(Doctype).save(
        ctx.getRepository(Doctype).create({ name: 'WF_NoAuth_Doc', label: 'No Auth Doc' }),
      );
      const noAuthWorkflow = await ctx.getRepository(Workflow).save(
        ctx.getRepository(Workflow).create({
          doctypeId: noAuthDoctype.id,
          workflowName: 'No Auth Workflow',
          isActive: true,
        }),
      );
      const naDraft = await ctx.getRepository(WorkflowState).save(
        ctx.getRepository(WorkflowState).create({
          workflowId: noAuthWorkflow.id,
          stateName: 'NA Draft',
          docstatus: 0,
          isEditable: true,
          isTerminal: false,
        }),
      );
      const naPending = await ctx.getRepository(WorkflowState).save(
        ctx.getRepository(WorkflowState).create({
          workflowId: noAuthWorkflow.id,
          stateName: 'NA Pending',
          docstatus: 0,
          isEditable: false,
          isTerminal: false,
        }),
      );
      const naApproved = await ctx.getRepository(WorkflowState).save(
        ctx.getRepository(WorkflowState).create({
          workflowId: noAuthWorkflow.id,
          stateName: 'NA Approved',
          docstatus: 1,
          isEditable: false,
          isTerminal: true,
        }),
      );
      noAuthApprovedId = naApproved.id;
      noAuthPendingId = naPending.id;
      noAuthDoctypeId = noAuthDoctype.id;

      await ctx.getRepository(WorkflowTransition).save(
        ctx.getRepository(WorkflowTransition).create({
          workflowId: noAuthWorkflow.id,
          fromStateId: naPending.id,
          toStateId: naApproved.id,
          roleId: managerRole.id,
          action: 'Approve',
          sequence: 1,
        }),
      );

      // A workflow with a condition for condition-gating tests
      const condDoctype = await ctx.getRepository(Doctype).save(
        ctx.getRepository(Doctype).create({ name: 'WF_Conditional_Doc', label: 'Conditional Doc' }),
      );

      await ctx.getRepository(Workflow).save(
        ctx.getRepository(Workflow).create({
          doctypeId: condDoctype.id,
          workflowName: 'Conditional Workflow',
          isActive: true,
          condition: 'value > 1000',
        }),
      );

      await ctx.getRepository(ApprovalAuthority).save(
        ctx.getRepository(ApprovalAuthority).create({
          roleId: managerRole.id,
          doctypeId: doctype.id,
          valueCeiling: 50000,
          canApprove: true,
        }),
      );

      const company = await ctx.getRepository(Company).save(
        ctx.getRepository(Company).create({ name: 'WE Co', baseCurrency: 'SAR' }),
      );
      companyId = company.id;

      assetAcctId = (
        await ctx.getRepository(Account).save(
          ctx.getRepository(Account).create({ name: 'WE Asset', type: AccountType.ASSET, companyId }),
        )
      ).id;

      incomeAcctId = (
        await ctx.getRepository(Account).save(
          ctx.getRepository(Account).create({ name: 'WE Income', type: AccountType.INCOME, companyId }),
        )
      ).id;

      await ctx.getRepository(FiscalYear).save(
        ctx.getRepository(FiscalYear).create({
          name: 'WE FY 2026',
          companyId,
          startDate: new Date('2026-01-01'),
          endDate: new Date('2026-12-31'),
          isClosed: false,
        }),
      );
    });
  }, 30000);

  afterAll(async () => {
    await schemaService.dropSchema(tenant as Tenant).catch(() => {});
    await dataSource.getRepository(Tenant).delete({ domain: 'workflow-engine-test' });
    await app.close();
  });

  // ── T0.30a: Submit blocked before approval ──────────────
  it('blocks submit when workflow is active and doc is not in approved state', async () => {
    const doc = await inTenant(async () => {
      const repo = ctx.getRepository(TransactionDocument);
      return repo.save(
        repo.create({
          companyId,
          title: 'Unapproved Doc',
          postingDate: new Date('2026-07-01'),
          docstatus: 0,
          workflowStateId: pendingStateId,
        }),
      );
    });

    await expect(
      inTenant(() =>
        lifecycleService.submit(doc, ctx.getRepository(TransactionDocument), {
          companyId,
          postingDate: new Date('2026-07-01'),
          referenceDoctype: 'WF_Engine_Doc',
          referenceDocId: '00000000-0000-0000-0000-000000000e10',
          lines: [
            { accountId: assetAcctId, debit: 100, credit: 0 },
            { accountId: incomeAcctId, debit: 0, credit: 100 },
          ],
        }, actorId),
      ),
    ).rejects.toThrow(/approved state/);
  });

  // ── T0.30b: Submit allowed when no active workflow ──────
  it('allows submit when no active workflow exists for the doctype', async () => {
    // Create a separate doctype with no workflow
    const noWfDoctype = await inTenant(async () => {
      return ctx.getRepository(Doctype).save(
        ctx.getRepository(Doctype).create({ name: 'WF_NoWorkflow', label: 'No Workflow' }),
      );
    });

    const doc = await inTenant(async () => {
      const repo = ctx.getRepository(TransactionDocument);
      return repo.save(
        repo.create({
          companyId,
          title: 'No Workflow Doc',
          postingDate: new Date('2026-07-01'),
          docstatus: 0,
        }),
      );
    });

    const entries = await inTenant(() =>
      lifecycleService.submit(doc, ctx.getRepository(TransactionDocument), {
        companyId,
        postingDate: new Date('2026-07-01'),
        referenceDoctype: noWfDoctype.name,
        referenceDocId: '00000000-0000-0000-0000-000000000e20',
        lines: [
          { accountId: assetAcctId, debit: 50, credit: 0 },
          { accountId: incomeAcctId, debit: 0, credit: 50 },
        ],
      }, actorId),
    );

    expect(entries).toHaveLength(2);
    expect(doc.docstatus).toBe(1);
  });

  // ── T0.30c: Approve transition logs action ─────────────
  it('approve transition creates WorkflowAction and updates doc state', async () => {
    const doc = await inTenant(async () => {
      const repo = ctx.getRepository(TransactionDocument);
      return repo.save(
        repo.create({
          companyId,
          title: 'Approve Me',
          postingDate: new Date('2026-07-01'),
          docstatus: 0,
          workflowStateId: pendingStateId,
        }),
      );
    });

    const action = await inTenant(() =>
      workflowEngine.applyTransition(
        doctypeId,
        doc,
        ctx.getRepository(TransactionDocument),
        pendingToApprovedId,
        managerActorId,
        'Approved by manager',
        1000,
      ),
    );

    expect(action.action).toBe('Approve');
    expect(action.toStateId).toBe(approvedStateId);
    expect(action.userId).toBe(managerActorId);
    expect(action.comment).toBe('Approved by manager');

    expect(doc.workflowStateId).toBe(approvedStateId);

    const actions = await inTenant(async () => {
      const repo = ctx.getRepository(WorkflowAction);
      return repo.find({ where: { referenceDocId: doc.id } });
    });
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe('Approve');
  });

  // ── T0.30d: Submit allowed after approval ──────────────
  it('allows submit after document is in approved state', async () => {
    const doc = await inTenant(async () => {
      const repo = ctx.getRepository(TransactionDocument);
      return repo.save(
        repo.create({
          companyId,
          title: 'Approved Doc',
          postingDate: new Date('2026-07-01'),
          docstatus: 0,
          workflowStateId: approvedStateId,
        }),
      );
    });

    const entries = await inTenant(() =>
      lifecycleService.submit(doc, ctx.getRepository(TransactionDocument), {
        companyId,
        postingDate: new Date('2026-07-01'),
        referenceDoctype: 'WF_Engine_Doc',
        referenceDocId: '00000000-0000-0000-0000-000000000e30',
        lines: [
          { accountId: assetAcctId, debit: 200, credit: 0 },
          { accountId: incomeAcctId, debit: 0, credit: 200 },
        ],
      }, actorId),
    );

    expect(entries).toHaveLength(2);
    expect(doc.docstatus).toBe(1);
  });

  // ── T0.30e: Reject requires reason ─────────────────────
  it('rejects transition requires a non-empty comment', async () => {
    const doc = await inTenant(async () => {
      const repo = ctx.getRepository(TransactionDocument);
      return repo.save(
        repo.create({
          companyId,
          title: 'Reject Me',
          postingDate: new Date('2026-07-01'),
          docstatus: 0,
          workflowStateId: pendingStateId,
        }),
      );
    });

    await expect(
      inTenant(() =>
        workflowEngine.applyTransition(
          doctypeId,
          doc,
          ctx.getRepository(TransactionDocument),
          pendingToRejectedId,
          managerActorId,
          '',
        ),
      ),
    ).rejects.toThrow(/rejection requires a reason/i);
  });

  it('reject transition succeeds with a comment and logs the action', async () => {
    const doc = await inTenant(async () => {
      const repo = ctx.getRepository(TransactionDocument);
      return repo.save(
        repo.create({
          companyId,
          title: 'Rejected Doc',
          postingDate: new Date('2026-07-01'),
          docstatus: 0,
          workflowStateId: pendingStateId,
        }),
      );
    });

    const action = await inTenant(() =>
      workflowEngine.applyTransition(
        doctypeId,
        doc,
        ctx.getRepository(TransactionDocument),
        pendingToRejectedId,
        managerActorId,
        'Not satisfactory',
      ),
    );

    expect(action.action).toBe('Reject');
    expect(action.comment).toBe('Not satisfactory');

    const actions = await inTenant(async () => {
      const repo = ctx.getRepository(WorkflowAction);
      return repo.find({ where: { referenceDocId: doc.id } });
    });
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe('Reject');
  });

  // ── T0.30f: Escalation when value exceeds ceiling ──────
  it('auto-escalates when value exceeds approval authority ceiling', async () => {
    const doc = await inTenant(async () => {
      const repo = ctx.getRepository(TransactionDocument);
      return repo.save(
        repo.create({
          companyId,
          title: 'Escalate Me',
          postingDate: new Date('2026-07-01'),
          docstatus: 0,
          workflowStateId: pendingStateId,
        }),
      );
    });

    const action = await inTenant(() =>
      workflowEngine.applyTransition(
        doctypeId,
        doc,
        ctx.getRepository(TransactionDocument),
        pendingToApprovedId,
        managerActorId,
        'Approving high value',
        100000,
      ),
    );

    expect(action.action).toBe('Escalate');
    expect(action.toStateId).toBe(escalatedStateId);
    expect(doc.workflowStateId).toBe(escalatedStateId);

    // Submit should still be blocked (not in approved state)
    await expect(
      inTenant(() =>
        lifecycleService.submit(doc, ctx.getRepository(TransactionDocument), {
          companyId,
          postingDate: new Date('2026-07-01'),
          referenceDoctype: 'WF_Engine_Doc',
          referenceDocId: '00000000-0000-0000-0000-000000000e40',
          lines: [
            { accountId: assetAcctId, debit: 300, credit: 0 },
            { accountId: incomeAcctId, debit: 0, credit: 300 },
          ],
        }, actorId),
      ),
    ).rejects.toThrow(/approved state/);
  });

  // ── T0.30h: Wrong-role actor is rejected ──────────────
  it('rejects transition when actor does not hold the required role', async () => {
    const doc = await inTenant(async () => {
      const repo = ctx.getRepository(TransactionDocument);
      return repo.save(
        repo.create({
          companyId,
          title: 'Wrong Role Doc',
          postingDate: new Date('2026-07-01'),
          docstatus: 0,
          workflowStateId: pendingStateId,
        }),
      );
    });

    // actorId has role 'user', but pendingToApprovedId requires 'manager'
    await expect(
      inTenant(() =>
        workflowEngine.applyTransition(
          doctypeId,
          doc,
          ctx.getRepository(TransactionDocument),
          pendingToApprovedId,
          actorId, // user role, not manager
          'Should fail',
          1000,
        ),
      ),
    ).rejects.toThrow(/does not have the required role/i);
  });

  // ── T0.30i: Submitted doc cannot receive transitions ───
  it('rejects transition on a submitted document (docstatus=1)', async () => {
    const doc = await inTenant(async () => {
      const repo = ctx.getRepository(TransactionDocument);
      return repo.save(
        repo.create({
          companyId,
          title: 'Submitted Transition Doc',
          postingDate: new Date('2026-07-01'),
          docstatus: 1, // already submitted
          workflowStateId: pendingStateId,
        }),
      );
    });

    await expect(
      inTenant(() =>
        workflowEngine.applyTransition(
          doctypeId,
          doc,
          ctx.getRepository(TransactionDocument),
          pendingToApprovedId,
          managerActorId,
          'Should fail',
          1000,
        ),
      ),
    ).rejects.toThrow(/draft documents/i);
  });

  // ── T0.30j: No ApprovalAuthority row = rejected ───────
  it('rejects approve when no ApprovalAuthority exists for the role/doctype', async () => {
    const doc = await inTenant(async () => {
      const repo = ctx.getRepository(TransactionDocument);
      return repo.save(
        repo.create({
          companyId,
          title: 'No Authority Doc',
          postingDate: new Date('2026-07-01'),
          docstatus: 0,
          workflowStateId: noAuthPendingId,
        }),
      );
    });

    // managerActorId has role 'manager' which has a pending→approved transition
    // for noAuthDoctypeId, but no ApprovalAuthority row exists for that combo
    const transition = await inTenant(async () => {
      return ctx.getRepository(WorkflowTransition).findOne({
        where: { fromStateId: noAuthPendingId, roleId: managerRoleId },
      });
    });
    if (!transition) throw new Error('NoAuth transition not found');

    await expect(
      inTenant(() =>
        workflowEngine.applyTransition(
          noAuthDoctypeId,
          doc,
          ctx.getRepository(TransactionDocument),
          transition.id,
          managerActorId,
          'Should fail',
          1000,
        ),
      ),
    ).rejects.toThrow(/no approval authority/i);
  });

  // ── T0.30k: Escalation respects sequence ordering ────
  it('picks the lowest sequence transition for escalation', async () => {
    const doc = await inTenant(async () => {
      const repo = ctx.getRepository(TransactionDocument);
      return repo.save(
        repo.create({
          companyId,
          title: 'Sequence Escalation Doc',
          postingDate: new Date('2026-07-01'),
          docstatus: 0,
          workflowStateId: pendingStateId,
        }),
      );
    });

    // Get all non-terminal transitions for manager from pending state
    const allFromPending = await inTenant(async () => {
      return ctx.getRepository(WorkflowTransition).find({
        where: { fromStateId: pendingStateId, roleId: managerRoleId },
        relations: { toState: true },
      });
    });

    // There are 4: pendingToApproved (seq=2), pendingToEscalated (seq=3),
    // pendingToRejected (seq=4, but terminal), pendingToPendingDirector (seq=5)
    // Escalation for exceeding ceiling should pick seq=3 over seq=5
    const action = await inTenant(() =>
      workflowEngine.applyTransition(
        doctypeId,
        doc,
        ctx.getRepository(TransactionDocument),
        pendingToApprovedId,
        managerActorId,
        'High value for sequence test',
        100000,
      ),
    );

    expect(action.action).toBe('Escalate');
    // Should go to the seq=3 target (escalatedStateId), not seq=5 (pendingDirectorStateId)
    expect(action.toStateId).toBe(escalatedStateId);
  });

  // ── T0.30l: Workflow condition gates transitions ────
  it('bypasses workflow when workflow condition is not met', async () => {
    // The 'WF_Conditional_Doc' doctype has an active workflow with condition 'value > 1000'
    const condDoctype = await inTenant(async () => {
      return ctx.getRepository(Doctype).findOneBy({ name: 'WF_Conditional_Doc' });
    });
    if (!condDoctype) throw new Error('Conditional doctype not found');

    const doc = await inTenant(async () => {
      const repo = ctx.getRepository(TransactionDocument);
      return repo.save(
        repo.create({
          companyId,
          title: 'Condition Not Met Doc',
          postingDate: new Date('2026-07-01'),
          docstatus: 0,
        }),
      );
    });

    // value=500 is <= 1000, condition not met → workflow does not apply → submit allowed
    const entries = await inTenant(() =>
      lifecycleService.submit(doc, ctx.getRepository(TransactionDocument), {
        companyId,
        postingDate: new Date('2026-07-01'),
        referenceDoctype: condDoctype.name,
        referenceDocId: '00000000-0000-0000-0000-000000000e50',
        lines: [
          { accountId: assetAcctId, debit: 500, credit: 0 },
          { accountId: incomeAcctId, debit: 0, credit: 500 },
        ],
      }, actorId),
    );

    expect(entries).toHaveLength(2);
    expect(doc.docstatus).toBe(1);
  });
});
