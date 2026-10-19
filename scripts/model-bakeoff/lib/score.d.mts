export const RULES: Readonly<Record<string, (s: string) => string>>;
export const MISSING: string;
export const PRESENT: string;
export type Kinds = Record<string, (value: unknown) => unknown>;
export function normalise(value: unknown, kind: string, custom?: Kinds): string;
export interface Collection {
  name: string;
  key: string;
  keyKind: string;
  fields: Record<string, string>;
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
export const DUPLICATES: string;
export function referenceDuplicates(spec: Spec, reference: unknown): string[];
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
};
