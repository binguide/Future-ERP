import { Tenant } from './tenant.entity';
import { Subscription } from './subscription.entity';
import { TenantUser } from './tenant-user.entity';

export { BaseEntity } from './base.entity';
export { Tenant } from './tenant.entity';
export { TenantUser, TenantUserRole } from './tenant-user.entity';
export { Subscription, SubscriptionStatus } from './subscription.entity';

/** Single source of truth for the public-schema entity set (TypeORM registration). */
export const entities = [Tenant, Subscription, TenantUser];
