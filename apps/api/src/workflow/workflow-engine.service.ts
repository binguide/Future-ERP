import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { tenantStorage, assertSafeSchemaName } from '../tenant/tenant-context';
import { TenantContextService } from '../tenant/tenant-context.service';
import { TransactionBase } from '../entities/transaction-base.entity';
import { Workflow } from '../entities/workflow.entity';
import { WorkflowState } from '../entities/workflow-state.entity';
import { WorkflowTransition } from '../entities/workflow-transition.entity';
import { WorkflowAction } from '../entities/workflow-action.entity';
import { ApprovalAuthority } from '../entities/approval-authority.entity';
import { Doctype } from '../entities/doctype.entity';
import { User } from '../entities/user.entity';
import { Role } from '../entities/role.entity';

@Injectable()
export class WorkflowEngineService {
  constructor(
    private readonly ctx: TenantContextService,
    private readonly dataSource: DataSource,
  ) {}

  async getActiveWorkflow(doctypeId: string): Promise<Workflow | null> {
    return this.ctx.getRepository(Workflow).findOne({
      where: { doctypeId, isActive: true },
    });
  }

  async getAvailableTransitions(
    workflowId: string,
    fromStateId: string,
    roleId: string,
  ): Promise<WorkflowTransition[]> {
    return this.ctx.getRepository(WorkflowTransition).find({
      where: { workflowId, fromStateId, roleId },
      relations: { fromState: true, toState: true },
    });
  }

  async canSubmit(
    doctypeIdOrName: string,
    doc: TransactionBase,
    value?: number,
  ): Promise<{ allowed: boolean; reason?: string }> {
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let doctype: Doctype | null = null;
    if (uuidRe.test(doctypeIdOrName)) {
      doctype = await this.ctx.getRepository(Doctype).findOneBy({ id: doctypeIdOrName });
    }
    if (!doctype) {
      doctype = await this.ctx.getRepository(Doctype).findOneBy({ name: doctypeIdOrName });
    }
    if (!doctype) {
      return { allowed: false, reason: `Doctype '${doctypeIdOrName}' not found` };
    }

    const workflow = await this.getActiveWorkflow(doctype.id);
    if (!workflow) return { allowed: true };

    if (workflow.condition && !this.evaluateCondition(workflow.condition, value)) {
      return { allowed: true, reason: 'Workflow condition not met — workflow does not apply' };
    }

    if (!doc.workflowStateId) {
      return { allowed: false, reason: 'Document has no workflow state' };
    }

    const state = await this.ctx.getRepository(WorkflowState).findOne({
      where: { id: doc.workflowStateId },
    });

    if (!state) {
      return { allowed: false, reason: 'Workflow state not found' };
    }

    if (state.docstatus !== 1) {
      return { allowed: false, reason: 'Document must be in an approved state before submission' };
    }

    return { allowed: true };
  }

  async applyTransition<T extends TransactionBase>(
    doctypeId: string,
    doc: T,
    repo: Repository<T>,
    transitionId: string,
    actorId: string,
    comment: string,
    value?: number,
  ): Promise<WorkflowAction> {
    const store = tenantStorage.getStore();
    if (!store) throw new Error('WorkflowEngineService requires a tenant context');
    const schema = assertSafeSchemaName(store.schemaName);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.query(`SET search_path TO "${schema}", public`);
    await queryRunner.startTransaction();

    try {
      const manager = queryRunner.manager;

      const lockedDoc = await manager.getRepository<T>(repo.target).findOneOrFail({
        where: { id: doc.id } as any,
        lock: { mode: 'pessimistic_write' },
      });

      const transition = await manager.getRepository(WorkflowTransition).findOne({
        where: { id: transitionId },
        relations: { fromState: true, toState: true, workflow: true },
      });
      if (!transition) throw new Error('Transition not found');

      if ((lockedDoc as any).docstatus !== 0) {
        throw new Error('Workflow transitions can only be applied to draft documents');
      }

      if (lockedDoc.workflowStateId !== transition.fromStateId) {
        throw new Error('Document is not in the expected state for this transition');
      }

      // Evaluate transition condition, if any
      if (transition.condition && !this.evaluateCondition(transition.condition, value)) {
        throw new Error(`Transition condition not met: ${transition.condition}`);
      }

      // Verify the actor holds the required role for this transition
      const actor = await manager.getRepository(User).findOneBy({ id: actorId });
      if (!actor) throw new Error('Actor not found');
      const roleForActor = await manager.getRepository(Role).findOneBy({ name: actor.role });
      if (!roleForActor || roleForActor.id !== transition.roleId) {
        throw new Error('User does not have the required role for this transition');
      }

      let targetStateId = transition.toStateId;
      let action = transition.action;

      if (action === 'Reject') {
        if (!comment || comment.trim().length === 0) {
          throw new Error('Rejection requires a reason');
        }
      } else if (action === 'Approve') {
        if (value === undefined) {
          throw new Error('Value is required for approval transition');
        }
        const authority = await manager.getRepository(ApprovalAuthority).findOne({
          where: { roleId: transition.roleId, doctypeId },
        });

        if (!authority) {
          throw new Error('No approval authority configured for this role and doctype');
        }

        if (authority.valueCeiling !== null && value > Number(authority.valueCeiling)) {
          const allRoleTransitions = await manager.getRepository(WorkflowTransition).find({
            where: {
              workflowId: transition.workflowId,
              fromStateId: transition.fromStateId,
              roleId: transition.roleId,
            },
            relations: { toState: true },
          });

          const escalationCandidates = allRoleTransitions
            .filter(t => t.toStateId !== transition.toStateId
              && !t.toState.isTerminal
              && t.toState.docstatus === 0)
            .sort((a, b) => a.sequence - b.sequence);

          const escalationTarget = escalationCandidates[0] ?? null;

          if (escalationTarget) {
            targetStateId = escalationTarget.toStateId;
            action = 'Escalate';
          } else {
            throw new Error('Value exceeds your approval authority and no escalation path is configured');
          }
        }
      }

      const workflowAction = manager.getRepository(WorkflowAction).create({
        doctypeId,
        referenceDocId: doc.id,
        fromStateId: transition.fromStateId,
        toStateId: targetStateId,
        action,
        userId: actorId,
        comment: comment || '',
      });
      await manager.getRepository(WorkflowAction).save(workflowAction);

      lockedDoc.workflowStateId = targetStateId;
      await manager.getRepository<T>(repo.target as any).save(lockedDoc as any);

      await queryRunner.commitTransaction();
      Object.assign(doc, lockedDoc);
      return workflowAction;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  private evaluateCondition(condition: string, value?: number): boolean {
    if (value === undefined) return false;
    const match = condition.trim().match(/^value\s*(>|>=|<|<=|==|!=)\s*(\d+(?:\.\d+)?)$/i);
    if (!match) return true;
    const op = match[1];
    const threshold = parseFloat(match[2]);
    switch (op) {
      case '>':  return value > threshold;
      case '>=': return value >= threshold;
      case '<':  return value < threshold;
      case '<=': return value <= threshold;
      case '==': return value === threshold;
      case '!=': return value !== threshold;
      default:   return true;
    }
  }
}
