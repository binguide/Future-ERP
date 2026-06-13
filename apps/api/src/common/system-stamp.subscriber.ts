import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  DataSource,
  EntitySubscriberInterface,
  InsertEvent,
  UpdateEvent,
} from 'typeorm';
import { RequestContextService } from './request-context.service';

@Injectable()
export class SystemStampSubscriber
  implements EntitySubscriberInterface, OnModuleInit
{
  private readonly logger = new Logger(SystemStampSubscriber.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: RequestContextService,
  ) {}

  onModuleInit(): void {
    this.dataSource.subscribers.push(this);
  }

  beforeInsert(event: InsertEvent<Record<string, unknown>>): void {
    const userId = this.context.getCurrentUserId();
    if (userId && event.entity) {
      if (!event.entity.createdBy) {
        event.entity.createdBy = userId;
      }
      if (!event.entity.modifiedBy) {
        event.entity.modifiedBy = userId;
      }
    } else if (!userId) {
      this.logger.warn('Insert outside HTTP context — created_by/modified_by will be null');
    }
  }

  beforeUpdate(event: UpdateEvent<Record<string, unknown>>): void {
    const userId = this.context.getCurrentUserId();
    if (!event.entity) {
      this.logger.warn('QueryBuilder update bypasses system stamps');
      return;
    }
    if (userId) {
      event.entity.modifiedBy = userId;
    }
  }
}
