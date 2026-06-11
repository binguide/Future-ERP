import { AbilityBuilder, Ability, AbilityClass } from '@casl/ability';
import { Injectable } from '@nestjs/common';
import { Role } from '../entities/role.entity';
import { Permission } from '../entities/permission.entity';
import { Doctype } from '../entities/doctype.entity';
import { TenantContextService } from '../tenant/tenant-context.service';

export type Action =
  | 'create' | 'read' | 'update' | 'delete'
  | 'submit' | 'cancel' | 'approve' | 'reject';

export type Subject = string;

export type AppAbility = Ability<[Action, Subject]>;

@Injectable()
export class AbilityFactory {
  constructor(private readonly ctx: TenantContextService) {}

  async createForRole(roleName: string): Promise<AppAbility> {
    const { can, build } = new AbilityBuilder<Ability<[Action, Subject]>>(
      Ability as AbilityClass<AppAbility>,
    );

    const role = await this.ctx.getRepository(Role).findOne({ where: { name: roleName } });

    let rolePerms: Permission[] = [];
    if (role) {
      const permRepo = this.ctx.getRepository(Permission);
      rolePerms = await permRepo.find({
        where: { role: { id: role.id } },
        relations: { doctype: true },
      });
    }

    for (const p of rolePerms) {
      const subject = p.doctype?.name ?? p.doctypeId;
      for (const action of this.actionsFromFlags(p)) {
        can(action, subject);
      }
    }

    return build();
  }

  private actionsFromFlags(p: Permission): Action[] {
    const actions: Action[] = [];
    if (p.create) actions.push('create');
    if (p.read) actions.push('read');
    if (p.update) actions.push('update');
    if (p.delete) actions.push('delete');
    if (p.submit) actions.push('submit');
    if (p.cancel) actions.push('cancel');
    if (p.approve) actions.push('approve');
    if (p.reject) actions.push('reject');
    return actions;
  }
}
