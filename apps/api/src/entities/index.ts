import { Tenant } from './tenant.entity';
import { Subscription } from './subscription.entity';
import { TenantUser } from './tenant-user.entity';
import { User } from './user.entity';

export { BaseEntity } from './base.entity';
export { Tenant } from './tenant.entity';
export { TenantUser, TenantUserRole } from './tenant-user.entity';
export { Subscription, SubscriptionStatus } from './subscription.entity';
export { User, UserRole } from './user.entity';

/** Public-schema entities (registered once in the root DataSource). */
export const publicEntities = [Tenant, Subscription, TenantUser];

/** Tenant-scoped entities (no schema — resolved via search_path at runtime). */
export const tenantEntities = [User];

/** All entities the DataSource must know about. */
export const entities = [...publicEntities, ...tenantEntities];
