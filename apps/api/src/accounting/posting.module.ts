import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PostingService } from './posting.service';
import { GLEntry } from '../entities/gl-entry.entity';
import { Company } from '../entities/company.entity';
import { FiscalYear } from '../entities/fiscal-year.entity';
import { Account } from '../entities/account.entity';

@Module({
  imports: [TypeOrmModule.forFeature([GLEntry, Company, FiscalYear, Account])],
  providers: [PostingService],
  exports: [PostingService],
})
export class PostingModule {}
