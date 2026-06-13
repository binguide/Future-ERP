import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestStore {
  userId: string | null;
}

@Injectable()
export class RequestContextService {
  private readonly storage = new AsyncLocalStorage<RequestStore>();

  run<T>(userId: string | null, fn: () => T): T {
    return this.storage.run({ userId }, fn);
  }

  getCurrentUserId(): string | null {
    return this.storage.getStore()?.userId ?? null;
  }
}
