export const RULES: Readonly<Record<string, (s: string) => string>>;
export const MISSING: string;
export const PRESENT: string;
export type Kinds = Record<string, (value: unknown) => unknown>;
export function normalise(value: unknown, kind: string, custom?: Kinds): string;
export interface Collection {
  name: string;
  key: string;
  keyKind: string;
  /** Every check in this collection is mechanical: a mismatch fails without a referee round. */
  mechanical?: boolean;
  /**
   * The reference's field values are right by construction (a held-out test that passed): a ruling
   * can credit an arm that differs, but never refutes a field check, so it never costs the arms that
   * matched it. Presence checks are unaffected.
   */
  refFixed?: boolean;
  fields: Record<string, string>;
  /** Every check in it is settled by the scorer alone and never goes to the referee. */
  mechanical?: boolean;
}
export interface Check {
  collection: string;
  key: string;
  field: string;
  check: string;
  ok: boolean;
  armKey: string;
  refKey: string;
  armRaw: string;
  refRaw: string;
  mechanical?: boolean;
  refFixed?: boolean;
}
export interface Disagreement {
  id: string;
  check: string;
  armRaw: string;
  refRaw: string;
  arms: string[];
}
export interface Ruling {
  id: string;
  armCorrect: boolean;
  refCorrect: boolean;
  note?: string;
}
export interface ArmScore {
  total: number;
  correct: number;
  unruled: number;
  byField: Record<string, { total: number; correct: number }>;
  errors: { check: string; got: string; expected: string }[];
}
export type Spec = { collections: Collection[]; kinds?: Kinds };
export const EXTRA: string;
export const WELL_FORMED: string;
export function referenceFaults(spec: Spec, reference: unknown): string[];
export function extraCandidates(
  spec: Spec,
  reference: unknown,
  outputs: unknown[],
): Record<string, [string, string][]>;
export function scoreRun(
  spec: Spec,
  reference: unknown,
  output: unknown,
  candidates?: Record<string, [string, string][]>,
): Check[];
export function disagreementId(c: Check): string;
export function groupDisagreements(checksByArm: Record<string, Check[]>): Disagreement[];
export function finalScores(
  checksByArm: Record<string, Check[]>,
  rulings?: Record<string, Ruling>,
): {
  per: Record<string, ArmScore>;
  referenceErrors: { check: string; reference: string; note: string }[];
  contradictions: string[];
  realExtras: string[];
};
