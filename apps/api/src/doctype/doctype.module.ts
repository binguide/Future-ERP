import { Module } from '@nestjs/common';
import { DoctypeService } from './doctype.service';

@Module({
  providers: [DoctypeService],
  exports: [DoctypeService],
})
export class DoctypeModule {}
