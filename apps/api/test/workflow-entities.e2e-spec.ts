import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Tenant } from '../src/entities/tenant.entity';
import { TenantSchemaService } from '../src/tenant/tenant-schema.service';
import { TenantContextService } from '../src/tenant/tenant-context.service';
import { Doctype } from '../src/entities/doctype.entity';
import { Workflow } from '../src/entities/workflow.entity';
import { WorkflowState } from '../src/entities/workflow-state.entity';
import { WorkflowTransition } from '../src/entities/workflow-transition.entity';
import { WorkflowAction } from '../src/entities/workflow-action.entity';
import { Role } from '../src/entities/role.entity';

describe('Workflow entities (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let schemaService: TenantSchemaService;
  let ctx: TenantContextService;

  const tenant: Partial<Tenant> = {
    id: '00000000-0000-0000-0000-000000000130',
    name: 'Workflow Entities Test Tenant',
    domain: 'workflow-entities-test',
    schemaName: 't_workflow_entities_test',
    isActive: true,
  };

  const inTenant = <T>(fn: () => Promise<T>): Promise<T> =>
    ctx.runInTenant(tenant.schemaName!, fn);

  let seq = 0;
  const unique = () => `_${++seq}`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    dataSource = app.get<DataSource>(DataSource);
    schemaService = app.get<TenantSchemaService>(TenantSchemaService);
    ctx = app.get<TenantContextService>(TenantContextService);

    const tenantRepo = dataSource.getRepository(Tenant);
    await tenantRepo.upsert(tenant as Tenant, ['domain']);
    // Fresh schema — drop any leftovers from an earlier run
    await schemaService.dropSchema(tenant as Tenant).catch(() => {});
    await schemaService.provisionSchema(tenant as Tenant);
  });

  afterAll(async () => {
    await app.close();
  });

  it('should create a Workflow for a Doctype', async () => {
    await inTenant(async () => {
      const si = await ctx.getRepository(Doctype).save(
        ctx.getRepository(Doctype).create({ name: `WF_SI${unique()}`, label: 'Sales Invoice' }),
      );
      const workflow = await ctx.getRepository(Workflow).save(
        ctx.getRepository(Workflow).create({
          doctypeId: si.id,
          workflowName: 'Sales Approval',
          isActive: true,
        }),
      );

      expect(workflow).toBeDefined();
      expect(workflow.id).toBeDefined();
      expect(workflow.doctypeId).toBe(si.id);
      expect(workflow.workflowName).toBe('Sales Approval');
      expect(workflow.isActive).toBe(true);
    });
  });

  it('should create WorkflowStates and link them to a Workflow', async () => {
    await inTenant(async () => {
      const doctype = await ctx.getRepository(Doctype).save(
        ctx.getRepository(Doctype).create({ name: `WF_PO${unique()}`, label: 'Purchase Order' }),
      );
      const workflow = await ctx.getRepository(Workflow).save(
        ctx.getRepository(Workflow).create({
          doctypeId: doctype.id,
          workflowName: 'Purchase Approval',
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
      const pending = await ctx.getRepository(WorkflowState).save(
        ctx.getRepository(WorkflowState).create({
          workflowId: workflow.id,
          stateName: 'Pending Approval',
          docstatus: 0,
          isEditable: false,
          isTerminal: false,
        }),
      );
      const approved = await ctx.getRepository(WorkflowState).save(
        ctx.getRepository(WorkflowState).create({
          workflowId: workflow.id,
          stateName: 'Approved',
          docstatus: 1,
          isEditable: false,
          isTerminal: true,
        }),
      );
      const rejected = await ctx.getRepository(WorkflowState).save(
        ctx.getRepository(WorkflowState).create({
          workflowId: workflow.id,
          stateName: 'Rejected',
          docstatus: 0,
          isEditable: false,
          isTerminal: true,
        }),
      );

      expect(draft.stateName).toBe('Draft');
      expect(draft.docstatus).toBe(0);
      expect(draft.isEditable).toBe(true);
      expect(draft.isTerminal).toBe(false);

      expect(approved.docstatus).toBe(1);
      expect(approved.isTerminal).toBe(true);

      const states = await ctx.getRepository(WorkflowState).find({
        where: { workflowId: workflow.id },
        order: { stateName: 'ASC' },
      });
      expect(states).toHaveLength(4);
    });
  });

  it('should create WorkflowTransitions between states with a Role', async () => {
    await inTenant(async () => {
      const doctype = await ctx.getRepository(Doctype).save(
        ctx.getRepository(Doctype).create({ name: `WF_SO${unique()}`, label: 'Sales Order' }),
      );
      const workflow = await ctx.getRepository(Workflow).save(
        ctx.getRepository(Workflow).create({
          doctypeId: doctype.id,
          workflowName: 'Sales Order Approval',
          isActive: true,
        }),
      );

      const draft = await ctx.getRepository(WorkflowState).save(
        ctx.getRepository(WorkflowState).create({
          workflowId: workflow.id,
          stateName: 'Draft',
          docstatus: 0,
          isEditable: true,
        }),
      );
      const pending = await ctx.getRepository(WorkflowState).save(
        ctx.getRepository(WorkflowState).create({
          workflowId: workflow.id,
          stateName: 'Pending Approval',
          docstatus: 0,
          isEditable: false,
        }),
      );
      const approved = await ctx.getRepository(WorkflowState).save(
        ctx.getRepository(WorkflowState).create({
          workflowId: workflow.id,
          stateName: 'Approved',
          docstatus: 1,
          isTerminal: true,
        }),
      );
      const rejected = await ctx.getRepository(WorkflowState).save(
        ctx.getRepository(WorkflowState).create({
          workflowId: workflow.id,
          stateName: 'Rejected',
          docstatus: 0,
          isTerminal: true,
        }),
      );

      const salesRole = await ctx.getRepository(Role).save(
        ctx.getRepository(Role).create({ name: `WF_SM${unique()}` }),
      );
      const financeRole = await ctx.getRepository(Role).save(
        ctx.getRepository(Role).create({ name: `WF_FM${unique()}` }),
      );

      const submitTxn = await ctx.getRepository(WorkflowTransition).save(
        ctx.getRepository(WorkflowTransition).create({
          workflowId: workflow.id,
          fromStateId: draft.id,
          toStateId: pending.id,
          roleId: salesRole.id,
          sequence: 1,
        }),
      );
      const approveTxn = await ctx.getRepository(WorkflowTransition).save(
        ctx.getRepository(WorkflowTransition).create({
          workflowId: workflow.id,
          fromStateId: pending.id,
          toStateId: approved.id,
          roleId: salesRole.id,
          sequence: 2,
        }),
      );
      const rejectTxn = await ctx.getRepository(WorkflowTransition).save(
        ctx.getRepository(WorkflowTransition).create({
          workflowId: workflow.id,
          fromStateId: pending.id,
          toStateId: rejected.id,
          roleId: salesRole.id,
          action: 'Reject',
          sequence: 3,
        }),
      );
      const financeApproveTxn = await ctx.getRepository(WorkflowTransition).save(
        ctx.getRepository(WorkflowTransition).create({
          workflowId: workflow.id,
          fromStateId: pending.id,
          toStateId: approved.id,
          roleId: financeRole.id,
          condition: 'grand_total > 50000',
          sequence: 4,
        }),
      );

      expect(submitTxn.fromStateId).toBe(draft.id);
      expect(submitTxn.toStateId).toBe(pending.id);
      expect(approveTxn.condition).toBeNull();
      expect(financeApproveTxn.condition).toBe('grand_total > 50000');

      const transitions = await ctx.getRepository(WorkflowTransition).find({
        where: { workflowId: workflow.id },
        order: { sequence: 'ASC' },
      });
      expect(transitions).toHaveLength(4);
    });
  });

  it('should create a WorkflowAction audit record', async () => {
    await inTenant(async () => {
      const doctype = await ctx.getRepository(Doctype).save(
        ctx.getRepository(Doctype).create({ name: `WF_EC${unique()}`, label: 'Expense Claim' }),
      );
      const workflow = await ctx.getRepository(Workflow).save(
        ctx.getRepository(Workflow).create({
          doctypeId: doctype.id,
          workflowName: 'Expense Approval',
          isActive: true,
        }),
      );

      const pending = await ctx.getRepository(WorkflowState).save(
        ctx.getRepository(WorkflowState).create({
          workflowId: workflow.id,
          stateName: 'Pending Approval',
          docstatus: 0,
        }),
      );
      const approved = await ctx.getRepository(WorkflowState).save(
        ctx.getRepository(WorkflowState).create({
          workflowId: workflow.id,
          stateName: 'Approved',
          docstatus: 1,
          isTerminal: true,
        }),
      );

      const docId = '00000000-0000-0000-0000-000000000201';
      const userId = '00000000-0000-0000-0000-000000000202';

      const approveAction = await ctx.getRepository(WorkflowAction).save(
        ctx.getRepository(WorkflowAction).create({
          doctypeId: doctype.id,
          referenceDocId: docId,
          fromStateId: pending.id,
          toStateId: approved.id,
          action: 'Approve',
          userId,
          comment: 'Looks good, approved.',
        }),
      );

      expect(approveAction.referenceDocId).toBe(docId);
      expect(approveAction.action).toBe('Approve');
      expect(approveAction.comment).toBe('Looks good, approved.');
      expect(approveAction.userId).toBe(userId);

      const actions = await ctx.getRepository(WorkflowAction).find({
        where: { doctypeId: doctype.id, referenceDocId: docId },
      });
      expect(actions).toHaveLength(1);
    });
  });

  it('should reject duplicate state names within a Workflow', async () => {
    await inTenant(async () => {
      const doctype = await ctx.getRepository(Doctype).save(
        ctx.getRepository(Doctype).create({ name: `WF_Q${unique()}`, label: 'Quote' }),
      );
      const workflow = await ctx.getRepository(Workflow).save(
        ctx.getRepository(Workflow).create({
          doctypeId: doctype.id,
          workflowName: 'Quote Approval',
          isActive: true,
        }),
      );

      await ctx.getRepository(WorkflowState).save(
        ctx.getRepository(WorkflowState).create({
          workflowId: workflow.id,
          stateName: 'Draft',
          docstatus: 0,
        }),
      );

      await expect(
        ctx.getRepository(WorkflowState).save(
          ctx.getRepository(WorkflowState).create({
            workflowId: workflow.id,
            stateName: 'Draft',
            docstatus: 0,
          }),
        ),
      ).rejects.toThrow();
    });
  });

  it('should reject duplicate transition (workflow, from, to, role)', async () => {
    await inTenant(async () => {
      const doctype = await ctx.getRepository(Doctype).save(
        ctx.getRepository(Doctype).create({ name: `WF_Inv${unique()}`, label: 'Invoice' }),
      );
      const workflow = await ctx.getRepository(Workflow).save(
        ctx.getRepository(Workflow).create({
          doctypeId: doctype.id,
          workflowName: 'Invoice Approval',
          isActive: true,
        }),
      );

      const draft = await ctx.getRepository(WorkflowState).save(
        ctx.getRepository(WorkflowState).create({
          workflowId: workflow.id,
          stateName: 'Draft',
          docstatus: 0,
        }),
      );
      const approved = await ctx.getRepository(WorkflowState).save(
        ctx.getRepository(WorkflowState).create({
          workflowId: workflow.id,
          stateName: 'Approved',
          docstatus: 1,
          isTerminal: true,
        }),
      );
      const role = await ctx.getRepository(Role).save(
        ctx.getRepository(Role).create({ name: `WF_Mgr${unique()}` }),
      );

      await ctx.getRepository(WorkflowTransition).save(
        ctx.getRepository(WorkflowTransition).create({
          workflowId: workflow.id,
          fromStateId: draft.id,
          toStateId: approved.id,
          roleId: role.id,
          sequence: 1,
        }),
      );

      await expect(
        ctx.getRepository(WorkflowTransition).save(
          ctx.getRepository(WorkflowTransition).create({
            workflowId: workflow.id,
            fromStateId: draft.id,
            toStateId: approved.id,
            roleId: role.id,
            sequence: 2,
          }),
        ),
      ).rejects.toThrow();
    });
  });

  it('should allow an active workflow per doctype, and multiple workflows can exist', async () => {
    await inTenant(async () => {
      const doctype1 = await ctx.getRepository(Doctype).save(
        ctx.getRepository(Doctype).create({ name: `WF_DN${unique()}`, label: 'Delivery Note' }),
      );
      const doctype2 = await ctx.getRepository(Doctype).save(
        ctx.getRepository(Doctype).create({ name: `WF_PE${unique()}`, label: 'Payment Entry' }),
      );

      const wf1 = await ctx.getRepository(Workflow).save(
        ctx.getRepository(Workflow).create({
          doctypeId: doctype1.id,
          workflowName: 'Delivery Approval',
          isActive: true,
        }),
      );
      const wf2 = await ctx.getRepository(Workflow).save(
        ctx.getRepository(Workflow).create({
          doctypeId: doctype2.id,
          workflowName: 'Payment Approval',
          isActive: true,
        }),
      );

      expect(wf1.doctypeId).toBe(doctype1.id);
      expect(wf2.doctypeId).toBe(doctype2.id);

      const wf1b = await ctx.getRepository(Workflow).save(
        ctx.getRepository(Workflow).create({
          doctypeId: doctype1.id,
          workflowName: 'Delivery Approval v2',
          isActive: false,
        }),
      );
      expect(wf1b.isActive).toBe(false);
    });
  });
});
