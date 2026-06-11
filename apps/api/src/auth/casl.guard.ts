import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AbilityFactory, Action } from '../permissions/ability.factory';

@Injectable()
export class CaslGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly abilityFactory: AbilityFactory,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user || !user.role) {
      throw new ForbiddenException('No authenticated user');
    }

    // Map HTTP method to CASL action
    const method = request.method;
    const action = this.methodToAction(method);

    // Get doctype from route params
    const doctype = request.params?.doctype;
    if (!doctype) {
      return true;
    }

    const ability = await this.abilityFactory.createForRole(user.role);

    const allowed = ability.can(action, doctype);
    if (!allowed) {
      throw new ForbiddenException(
        `Role "${user.role}" is not allowed to ${action} "${doctype}"`,
      );
    }

    return true;
  }

  private methodToAction(method: string): Action {
    switch (method.toUpperCase()) {
      case 'GET':    return 'read';
      case 'POST':   return 'create';
      case 'PUT':    return 'update';
      case 'PATCH':  return 'update';
      case 'DELETE': return 'delete';
      default:       return 'read';
    }
  }
}
