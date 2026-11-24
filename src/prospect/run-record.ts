import { AsyncLocalStorage } from "node:async_hooks";

/** What one stage cost to run. `costUsd` and `calls` are absent when the stage
 *  made no model call that reported a cost (crawl, checks, and every stage on
 *  the API path, which records no cost). */
export type StageRecord = { ms: number; costUsd?: number; calls?: number };

/** Bookkeeping about the run itself: how long each stage took and what the
 *  model stages reported. No report renders it. */
export type RunRecord = {
  stages: Partial<Record<string, StageRecord>>;
  /** Sum of the recorded stage costs, or null when no stage recorded one. */
  totalCostUsd: number | null;
};

export type CostStore = { costUsd: number; calls: number };

const scope = new AsyncLocalStorage<CostStore>();

/** Adds one model call's reported cost to the stage that is running. A no-op
 *  outside a stage, and for anything that is not a finite, non-negative number. */
export function recordModelCost(usd: unknown): void {
  const store = scope.getStore();
  if (!store || typeof usd !== "number" || !Number.isFinite(usd) || usd < 0) return;
  store.costUsd += usd;
  store.calls += 1;
}

/** Runs `fn` with its own cost store. `into` lets a caller keep the store when
 *  `fn` throws, since a failed model call still spent money. */
export async function withCostScope<T>(
  fn: () => Promise<T>,
  into: CostStore = { costUsd: 0, calls: 0 },
): Promise<{ value: T; costUsd: number | undefined; calls: number | undefined }> {
  const value = await scope.run(into, fn);
  return {
    value,
    costUsd: into.calls > 0 ? into.costUsd : undefined,
    calls: into.calls > 0 ? into.calls : undefined,
  };
}
