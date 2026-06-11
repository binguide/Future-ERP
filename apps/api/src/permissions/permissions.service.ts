import { Injectable } from '@nestjs/common';
import { Role } from '../entities/role.entity';
import { Permission } from '../entities/permission.entity';
import { UserPermission } from '../entities/user-permission.entity';
import { ApprovalAuthority } from '../entities/approval-authority.entity';
import { TenantContextService } from '../tenant/tenant-context.service';

@Injectable()
export class PermissionsService {
  constructor(private readonly ctx: TenantContextService) {}

  // RBAC tables are tenant-scoped: resolve repos from the request's pinned
  // connection so they hit the tenant schema, not the shared pool.
  private get roleRepo() {
    return this.ctx.getRepository(Role);
  }
  private get permRepo() {
    return this.ctx.getRepository(Permission);
  }
  private get userPermRepo() {
    return this.ctx.getRepository(UserPermission);
  }
  private get approvalRepo() {
    return this.ctx.getRepository(ApprovalAuthority);
  }

  async createRole(name: string, description?: string): Promise<Role> {
    return this.roleRepo.save(this.roleRepo.create({ name, description }));
  }

  async listRoles(): Promise<Role[]> {
    return this.roleRepo.find({ order: { name: 'ASC' } });
  }

  async setRolePermission(
    roleId: string,
    doctypeId: string,
    perms: Partial<Permission>,
  ): Promise<Permission> {
    return this.permRepo.save(
      this.permRepo.create({ roleId, doctypeId, ...perms }),
    );
  }

  async getRolePermissions(roleId: string): Promise<Permission[]> {
    return this.permRepo.find({
      where: { role: { id: roleId } },
      relations: { doctype: true },
    });
  }

  async setUserPermission(
    userId: string,
    doctypeId: string,
    perms: Partial<UserPermission>,
  ): Promise<UserPermission> {
    return this.userPermRepo.save(
      this.userPermRepo.create({ userId, doctypeId, ...perms }),
    );
  }

  async getUserPermissions(userId: string): Promise<UserPermission[]> {
    return this.userPermRepo.find({
      where: { user: { id: userId } },
      relations: { doctype: true },
    });
  }

  async setApprovalAuthority(
    roleId: string,
    doctypeId: string,
    valueCeiling: number | null,
    canApprove: boolean,
  ): Promise<ApprovalAuthority> {
    const created = this.approvalRepo.create({
      roleId,
      doctypeId,
      valueCeiling: valueCeiling ?? undefined,
      canApprove,
    });
    return this.approvalRepo.save(created);
  }
}
