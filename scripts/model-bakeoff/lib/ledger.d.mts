export interface RateCard {
  in: number;
  out: number;
  cr: number;
  cw5m: number;
  cw1h: number;
  long?: RateCard & { above: number };
}
export interface Usage {
  in: number;
  out: number;
  cr: number;
  cw: number;
  cw5m: number;
  cw1h: number;
  ttlUnknown: boolean;
}
export interface UsageRecord {
  id: string;
  model: string;
  effort: string;
  timestamp?: string;
  usage: Usage;
}
export interface Row {
  model: string;
  effort: string;
  requests: number;
  input: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  output: number;
  cost: number;
  priced: boolean;
  longPrompt: number;
  ttlUnknown: number;
}
export const PRICE_SOURCE: string;
export const PRICES: Readonly<Record<string, RateCard>>;
export function splitLines(text: string): Generator<string>;
export function usageRecords(lines: Iterable<string>): {
  records: UsageRecord[];
  diag: { usageLines: number; repeats: number; parseErrors: number; noId: number };
};
export function mergeRecords<T extends { id: string }>(
  lists: T[][],
): { records: T[]; crossFileRepeats: number };
export function priceRequest(model: string, u: Usage): { cost: number | null; longPrompt: boolean };
export function summarise(records: UsageRecord[]): { rows: Row[]; total: Row };
export function formatTable(summary: { rows: Row[]; total: Row }): string;
