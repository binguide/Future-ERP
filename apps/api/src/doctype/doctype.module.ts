import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Doctype } from '../entities/doctype.entity';
import { DocField } from '../entities/docfield.entity';
import { DoctypeService } from './doctype.service';

@Module({
  imports: [TypeOrmModule.forFeature([Doctype, DocField])],
  providers: [DoctypeService],
  exports: [DoctypeService],
})
export class DoctypeModule {}
