import { Injectable } from '@nestjs/common';
import { DataSource, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { tenantStorage, assertSafeSchemaName } from '../tenant/tenant-context';
import { GLEntry } from '../entities/gl-entry.entity';
import { Company } from '../entities/company.entity';
import { FiscalYear } from '../entities/fiscal-year.entity';
import { Account } from '../entities/account.entity';

export interface PostingLine {
  accountId: string;
  debit: number;
  credit: number;
  currency?: string;
  exchangeRate?: number;
  costCenterId?: string;
  branchId?: string;
  description?: string;
}

export interface PostingInput {
  companyId: string;
  postingDate: Date;
  referenceDoctype: string;
  referenceDocId: string;
  lines: PostingLine[];
  description?: string;
}

@Injectable()
export class PostingService {
  constructor(private readonly dataSource: DataSource) {}

  async post(input: PostingInput): Promise<GLEntry[]> {
    const store = tenantStorage.getStore();
    if (!store) throw new Error('PostingService requires a tenant context');

    const schema = assertSafeSchemaName(store.schemaName);
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.query(`SET search_path TO "${schema}", public`);
    await queryRunner.startTransaction();

    try {
      const manager = queryRunner.manager;

      // ── Load company for base currency ──
      const company = await manager.getRepository(Company).findOneByOrFail({ id: input.companyId });

      // ── Check fiscal period is open ──
      const fiscalYear = await manager.getRepository(FiscalYear).findOne({
        where: {
          companyId: input.companyId,
          startDate: LessThanOrEqual(input.postingDate),
          endDate: MoreThanOrEqual(input.postingDate),
        },
      });
      if (fiscalYear?.isClosed) {
        throw new Error(`Fiscal period ${fiscalYear.name} is closed`);
      }

      // ── Validate lines ──
      if (!input.lines.length) throw new Error('At least one posting line is required');

      let totalBaseDebit = 0;
      let totalBaseCredit = 0;
      const entries: GLEntry[] = [];

      for (const line of input.lines) {
        if (line.debit && line.credit) {
          throw new Error('A single line cannot have both debit and credit');
        }
        if (!line.debit && !line.credit) {
          throw new Error('A line must have either debit or credit');
        }
        if (line.debit < 0 || line.credit < 0) {
          throw new Error('Debit and credit must be non-negative');
        }

        const currency = line.currency ?? company.baseCurrency;
        const exchangeRate = line.exchangeRate ?? 1;
        const baseDebit = Math.round(line.debit * exchangeRate * 100) / 100;
        const baseCredit = Math.round(line.credit * exchangeRate * 100) / 100;

        totalBaseDebit += baseDebit;
        totalBaseCredit += baseCredit;

        const entry = manager.getRepository(GLEntry).create({
          companyId: input.companyId,
          accountId: line.accountId,
          debit: line.debit,
          credit: line.credit,
          currency,
          exchangeRate,
          baseDebit,
          baseCredit,
          postingDate: input.postingDate,
          referenceDoctype: input.referenceDoctype,
          referenceDocId: input.referenceDocId,
          costCenterId: line.costCenterId ?? null,
          branchId: line.branchId ?? null,
          description: line.description ?? null,
        });

        entries.push(entry);
      }

      // ── Balance check in base currency ──
      totalBaseDebit = Math.round(totalBaseDebit * 100) / 100;
      totalBaseCredit = Math.round(totalBaseCredit * 100) / 100;
      if (totalBaseDebit !== totalBaseCredit) {
        throw new Error(
          `Unbalanced entry: total base debit (${totalBaseDebit}) ≠ total base credit (${totalBaseCredit})`,
        );
      }

      // ── Verify all accounts exist ──
      const accountIds = [...new Set(input.lines.map((l) => l.accountId))];
      const accountCount = await manager
        .getRepository(Account)
        .count({ where: accountIds.map((id) => ({ id })) });
      if (accountCount !== accountIds.length) {
        throw new Error('One or more account IDs not found');
      }

      const saved = await manager.getRepository(GLEntry).save(entries);
      await queryRunner.commitTransaction();
      return saved;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  async cancel(original: GLEntry[], input: PostingInput): Promise<GLEntry[]> {
    const reversalLines: PostingLine[] = original.map((e) => ({
      accountId: e.accountId,
      debit: Number(e.credit),
      credit: Number(e.debit),
      currency: e.currency,
      exchangeRate: Number(e.exchangeRate),
      costCenterId: e.costCenterId ?? undefined,
      branchId: e.branchId ?? undefined,
    }));

    return this.post({ ...input, lines: reversalLines });
  }
}
