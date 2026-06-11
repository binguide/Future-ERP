declare module '@casl/ability' {
  export type AbilityClass<T> = new (abilities?: unknown[]) => T;
  export class Ability<A = string, S = string> {
    can(action: A extends [infer Act, infer Subj] ? Act : A, subject: A extends [infer Act, infer Subj] ? Subj : S): boolean;
  }
  export class AbilityBuilder<T> {
    constructor(AbilityClass: AbilityClass<T>);
    can: (action: string, subject: string) => void;
    build: () => T;
  }
}
