import { Tenant } from './tenant.entity';
import { Subscription } from './subscription.entity';
import { TenantUser } from './tenant-user.entity';
import { User } from './user.entity';
import { Doctype } from './doctype.entity';
import { DocField } from './docfield.entity';
import { DataDocument } from './data-document.entity';
import { Role } from './role.entity';
import { Permission } from './permission.entity';
import { UserPermission } from './user-permission.entity';
import { ApprovalAuthority } from './approval-authority.entity';
import { Company } from './company.entity';
import { Branch } from './branch.entity';
import { Currency } from './currency.entity';
import { ExchangeRate } from './exchange-rate.entity';
import { FiscalYear } from './fiscal-year.entity';
import { CostCenter } from './cost-center.entity';
import { Account } from './account.entity';
import { GLEntry } from './gl-entry.entity';
import { TransactionDocument } from './transaction-document.entity';
import { Workflow } from './workflow.entity';
import { WorkflowState } from './workflow-state.entity';
import { WorkflowTransition } from './workflow-transition.entity';
import { DocVersion } from './doc-version.entity';
import { ActivityLog } from './activity-log.entity';
import { Comment } from './comment.entity';
import { WorkflowAction } from './workflow-action.entity';

export { BaseEntity } from './base.entity';
export { Tenant } from './tenant.entity';
export { TenantUser, TenantUserRole } from './tenant-user.entity';
export { Subscription, SubscriptionStatus } from './subscription.entity';
export { User, UserRole } from './user.entity';
export { Doctype } from './doctype.entity';
export { DocField } from './docfield.entity';
export { DataDocument } from './data-document.entity';
export { Role } from './role.entity';
export { Permission } from './permission.entity';
export { UserPermission } from './user-permission.entity';
export { ApprovalAuthority } from './approval-authority.entity';
export { Company } from './company.entity';
export { Branch } from './branch.entity';
export { Currency } from './currency.entity';
export { ExchangeRate } from './exchange-rate.entity';
export { FiscalYear } from './fiscal-year.entity';
export { CostCenter } from './cost-center.entity';
export { Account, AccountType } from './account.entity';
export { GLEntry } from './gl-entry.entity';
export { TransactionBase } from './transaction-base.entity';
export { TransactionDocument } from './transaction-document.entity';
export { DocVersion } from './doc-version.entity';
export { ActivityLog } from './activity-log.entity';
export { Comment } from './comment.entity';
export { Workflow } from './workflow.entity';
export { WorkflowState } from './workflow-state.entity';
export { WorkflowTransition } from './workflow-transition.entity';
export { WorkflowAction } from './workflow-action.entity';

/** Public-schema entities (registered once in the root DataSource). */
export const publicEntities = [Tenant, Subscription, TenantUser];

/** Tenant-scoped entities (no schema — resolved via search_path at runtime). */
export const tenantEntities = [
  User, Doctype, DocField, DataDocument,
  Role, Permission, UserPermission, ApprovalAuthority,
  Company, Branch, Currency, ExchangeRate,
  FiscalYear, CostCenter, Account, GLEntry, TransactionDocument,
  DocVersion, ActivityLog, Comment,
  Workflow, WorkflowState, WorkflowTransition, WorkflowAction,
];

/** All entities the DataSource must know about. */
export const entities = [...publicEntities, ...tenantEntities];
