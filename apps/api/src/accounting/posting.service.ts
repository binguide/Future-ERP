import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { tenantStorage, assertSafeSchemaName } from '../tenant/tenant-context';
import { GLEntry } from '../entities/gl-entry.entity';
import { Company } from '../entities/company.entity';
import { FiscalYear } from '../entities/fiscal-year.entity';
import { Account } from '../entities/account.entity';
import { ExchangeRate } from '../entities/exchange-rate.entity';

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

      // ── Check fiscal period exists and is open ──
      const fiscalYear = await manager.getRepository(FiscalYear).findOne({
        where: {
          companyId: input.companyId,
          startDate: LessThanOrEqual(input.postingDate),
          endDate: MoreThanOrEqual(input.postingDate),
        },
      });
      if (!fiscalYear) {
        throw new Error(`No open fiscal period for ${this.formatDate(input.postingDate)}`);
      }
      if (fiscalYear.isClosed) {
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
        const exchangeRate = await this.resolveExchangeRate(
          manager,
          currency,
          company.baseCurrency,
          line.exchangeRate,
          input.postingDate,
        );
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

      // ── Verify all accounts exist, belong to the company, and are postable (leaf) ──
      const accountIds = [...new Set(input.lines.map((l) => l.accountId))];
      const accounts = await manager
        .getRepository(Account)
        .find({ where: accountIds.map((id) => ({ id })) });
      const accountById = new Map(accounts.map((a) => [a.id, a]));
      for (const id of accountIds) {
        const account = accountById.get(id);
        if (!account) {
          throw new Error(`Account ${id} not found`);
        }
        if (account.companyId !== input.companyId) {
          throw new Error(`Account ${id} does not belong to company ${input.companyId}`);
        }
        if (account.isGroup) {
          throw new Error(`Account ${account.name} is a group account and cannot be posted to`);
        }
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

  /**
   * Resolve the exchange rate used to value a line in base currency.
   * - Base-currency lines always use the supplied rate or 1.
   * - Foreign-currency lines use the supplied rate if given, otherwise the most
   *   recent ExchangeRate (valid_from <= postingDate) for that currency code.
   *   A missing rate is an error — we never silently value foreign currency 1:1.
   */
  private async resolveExchangeRate(
    manager: EntityManager,
    currency: string,
    baseCurrency: string,
    suppliedRate: number | undefined,
    postingDate: Date,
  ): Promise<number> {
    if (currency === baseCurrency) {
      return suppliedRate ?? 1;
    }
    if (suppliedRate != null) {
      return suppliedRate;
    }

    const rateRow = await manager
      .getRepository(ExchangeRate)
      .createQueryBuilder('er')
      .innerJoin('er.currency', 'c')
      .where('c.code = :code', { code: currency })
      .andWhere('er.valid_from <= :postingDate', { postingDate })
      .orderBy('er.valid_from', 'DESC')
      .getOne();

    if (!rateRow) {
      throw new Error(
        `No exchange rate found for ${currency} on ${this.formatDate(postingDate)}`,
      );
    }
    return Number(rateRow.rate);
  }

  private formatDate(date: Date): string {
    return new Date(date).toISOString().slice(0, 10);
  }

  // NOTE: cancel() is not yet idempotent — it has no link back to the original
  // entries and no is_cancelled / reversal-reference guard, so calling it twice
  // over-reverses. The reversal-reference + docstatus (0/1/2) machinery belongs
  // to T0.24 (Submit/Cancel lifecycle); idempotency is deferred to that task.
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
