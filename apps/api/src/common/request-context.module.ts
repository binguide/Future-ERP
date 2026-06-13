import { Module, Global } from '@nestjs/common';
import { RequestContextService } from './request-context.service';
import { SystemStampSubscriber } from './system-stamp.subscriber';

@Global()
@Module({
  providers: [RequestContextService, SystemStampSubscriber],
  exports: [RequestContextService, SystemStampSubscriber],
})
export class RequestContextModule {}
