import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Currency } from './currency.entity';

@Entity({ name: 'exchange_rates' })
export class ExchangeRate extends BaseEntity {
  @Column({ name: 'currency_id' })
  currencyId: string;

  @ManyToOne(() => Currency)
  @JoinColumn({ name: 'currency_id' })
  currency: Currency;

  @Column({ type: 'decimal', precision: 18, scale: 6 })
  rate: number;

  @Column({ name: 'valid_from', type: 'date' })
  validFrom: Date;
}