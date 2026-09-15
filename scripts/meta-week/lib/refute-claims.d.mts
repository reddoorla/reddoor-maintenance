// Hand-written types for refute-claims.mjs. The module itself stays plain JS because the
// workflow script pastes its body inline and a workflow script has no build step; this
// file is only so `tsc --noEmit` can see the tests' import as something other than `any`.

export interface MeasuredRound {
  readonly passClaims: number;
  readonly passAgents: number;
  readonly passSubagentTokens: number;
  readonly failClaims: number;
  readonly failAgents: number;
  readonly failSubagentTokens: number;
  readonly basis: string;
}

export interface EvidenceRef {
  path: string;
  from: number;
  to: number;
}

export interface ParsedClaim {
  id: string;
  claim: string;
  evidence: string[];
  refs: (EvidenceRef | null)[];
}

export interface RoundEstimate {
  claims: number;
  skeptics: number;
  agents: number;
  chunks: number;
  chunk: number;
  subagentTokens: number;
  tokensPerClaim: number;
  belowFloor: boolean;
  basis: string;
}

export interface EnforcedVerdict {
  verdict: string;
  downgraded: boolean;
  downgradeReason?: string;
  [key: string]: unknown;
}

export const MEASURED_ROUND: MeasuredRound;
export const TOKENS_PER_CLAIM: number;
export const CLAIM_FLOOR: number;
export const DEFAULT_CHUNK: number;
export const DEFAULT_MODEL: string;
export const CHORE_MODEL: string;

export function parseEvidenceRef(ref: string): EvidenceRef | null;
export function resolveEvidencePath(p: string, repoRoot?: string): string;
export function resolveEvidenceRef(ref: string, repoRoot?: string): EvidenceRef | null;
export function formatEvidenceRef(ref: string, repoRoot?: string): string;
export function validateClaims(parsed: unknown): { claims: ParsedClaim[]; errors: string[] };
export function chunkClaims<T>(claims: T[], size?: number): T[][];
export function estimateRound(claimCount: number, chunk?: number): RoundEstimate;
export function formatEstimate(est: RoundEstimate): string;
export function enforceQuoteRule(
  verdict: unknown,
  claim?: unknown,
  repoRoot?: string,
): EnforcedVerdict;
