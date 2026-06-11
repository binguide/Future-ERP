import { Module } from '@nestjs/common';
import { PermissionsService } from './permissions.service';
import { AbilityFactory } from './ability.factory';
import { CaslGuard } from '../auth/casl.guard';

@Module({
  providers: [PermissionsService, AbilityFactory, CaslGuard],
  exports: [PermissionsService, AbilityFactory, CaslGuard],
})
export class PermissionsModule {}
