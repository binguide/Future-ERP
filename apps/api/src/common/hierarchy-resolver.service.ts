import { Injectable } from '@nestjs/common';

@Injectable()
export class HierarchyResolverService {
  /**
   * Walk an ordered list of async steps (most specific first).
   * Return the value from the first step that returns a non-null/non-undefined value.
   */
  async resolve<T>(steps: Array<() => Promise<T | null | undefined>>): Promise<T | null> {
    for (const step of steps) {
      const value = await step();
      if (value != null) return value;
    }
    return null;
  }
}
