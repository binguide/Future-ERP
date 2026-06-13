import { Global, Module } from '@nestjs/common';
import { WorkflowEngineService } from './workflow-engine.service';

@Global()
@Module({
  providers: [WorkflowEngineService],
  exports: [WorkflowEngineService],
})
export class WorkflowModule {}
