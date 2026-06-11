import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, In, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
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
  lines?: PostingLine[];
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
      const lines = input.lines;
      if (!lines?.length) throw new Error('At least one posting line is required');

      let totalBaseDebitCents = 0;
      let totalBaseCreditCents = 0;
      const entries: GLEntry[] = [];

      for (const line of lines) {
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

        // Integer-arithmetic: convert input amounts to cents, compute base in cents
        const debitCents = Math.round(line.debit * 100);
        const creditCents = Math.round(line.credit * 100);
        const baseDebitCents = Math.round(debitCents * exchangeRate);
        const baseCreditCents = Math.round(creditCents * exchangeRate);
        const baseDebit = baseDebitCents / 100;
        const baseCredit = baseCreditCents / 100;

        totalBaseDebitCents += baseDebitCents;
        totalBaseCreditCents += baseCreditCents;

        const entry = manager.getRepository(GLEntry).create({
          companyId: input.companyId,
          accountId: line.accountId,
          debit: debitCents / 100,
          credit: creditCents / 100,
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

      // ── Balance check in base currency (integer cents, no float drift) ──
      if (totalBaseDebitCents !== totalBaseCreditCents) {
        throw new Error(
          `Unbalanced entry: total base debit (${totalBaseDebitCents / 100}) ≠ total base credit (${totalBaseCreditCents / 100})`,
        );
      }

      // ── Verify all accounts exist, belong to the company, and are postable (leaf) ──
      const accountIds = [...new Set(lines.map((l) => l.accountId))];
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

  // NOTE: cancel() is idempotent — it checks that no entry has already been
  // reversed before creating reversal entries. Each reversal links back to its
  // original via reversalOf.
  async cancel(original: GLEntry[], input: PostingInput): Promise<GLEntry[]> {
    const store = tenantStorage.getStore();
    if (!store) throw new Error('PostingService requires a tenant context');

    const schema = assertSafeSchemaName(store.schemaName);
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.query(`SET search_path TO "${schema}", public`);
    await queryRunner.startTransaction();

    try {
      const manager = queryRunner.manager;
      const repo = manager.getRepository(GLEntry);

      // Reload originals within the transaction
      const originals = await repo.find({ where: { id: In(original.map((e) => e.id)) } });

      // Idempotency: reject if any original entry already has a reversal
      const originalIds = originals.map((e) => e.id);
      const existingReversals = await repo.count({ where: { reversalOf: In(originalIds) } });
      if (existingReversals > 0) {
        throw new Error('One or more entries have already been reversed');
      }

      // Load company for base currency
      const company = await manager.getRepository(Company).findOneByOrFail({ id: input.companyId });

      // Build reversal entries (swapped debit/credit)
      const entries: GLEntry[] = [];
      for (const originalEntry of originals) {
        const currency = originalEntry.currency;
        const exchangeRate = await this.resolveExchangeRate(
          manager,
          currency,
          company.baseCurrency,
          Number(originalEntry.exchangeRate),
          input.postingDate,
        );

        const debitCents = Math.round(Number(originalEntry.credit) * 100);
        const creditCents = Math.round(Number(originalEntry.debit) * 100);
        const baseDebitCents = Math.round(debitCents * exchangeRate);
        const baseCreditCents = Math.round(creditCents * exchangeRate);

        const entry = repo.create({
          companyId: input.companyId,
          accountId: originalEntry.accountId,
          debit: debitCents / 100,
          credit: creditCents / 100,
          currency,
          exchangeRate,
          baseDebit: baseDebitCents / 100,
          baseCredit: baseCreditCents / 100,
          postingDate: input.postingDate,
          referenceDoctype: input.referenceDoctype,
          referenceDocId: input.referenceDocId,
          costCenterId: originalEntry.costCenterId,
          branchId: originalEntry.branchId,
          description: input.description ?? null,
          isReversal: true,
          reversalOf: originalEntry.id,
        });
        entries.push(entry);
      }

      const saved = await repo.save(entries);
      await queryRunner.commitTransaction();
      return saved;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }
}
