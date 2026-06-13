import { Module } from '@nestjs/common';
import { PostingService } from './posting.service';
import { LifecycleService } from './lifecycle.service';

@Module({
  providers: [PostingService, LifecycleService],
  exports: [PostingService, LifecycleService],
})
export class PostingModule {}
