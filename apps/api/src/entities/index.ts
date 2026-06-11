import { Tenant } from './tenant.entity';
import { Subscription } from './subscription.entity';
import { TenantUser } from './tenant-user.entity';
import { User } from './user.entity';
import { Doctype } from './doctype.entity';
import { DocField } from './docfield.entity';
import { DataDocument } from './data-document.entity';

export { BaseEntity } from './base.entity';
export { Tenant } from './tenant.entity';
export { TenantUser, TenantUserRole } from './tenant-user.entity';
export { Subscription, SubscriptionStatus } from './subscription.entity';
export { User, UserRole } from './user.entity';
export { Doctype } from './doctype.entity';
export { DocField } from './docfield.entity';
export { DataDocument } from './data-document.entity';

/** Public-schema entities (registered once in the root DataSource). */
export const publicEntities = [Tenant, Subscription, TenantUser];

/** Tenant-scoped entities (no schema — resolved via search_path at runtime). */
export const tenantEntities = [User, Doctype, DocField, DataDocument];

/** All entities the DataSource must know about. */
export const entities = [...publicEntities, ...tenantEntities];
