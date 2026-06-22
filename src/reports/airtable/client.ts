import Airtable from "airtable";
import { defaultCredentialsPath } from "../../util/credentials.js";
import { applyThrottle } from "./throttle.js";

/** Min ms between Airtable HTTP starts. 220 ⇒ ≤ ~4.5 req/s, comfortably under
 *  Airtable's ~5 req/s-per-base cap with headroom for clock jitter. */
const MIN_REQUEST_INTERVAL_MS = 220;

export type AirtableConfig = {
  apiKey: string;
  baseId: string;
};

function missing(name: string): Error {
  return Object.assign(
    new Error(
      `${name} not set. Export it in your shell or put it in ${defaultCredentialsPath()} as ${name}=...`,
    ),
    { exitCode: 2 },
  );
}

export function readAirtableConfig(): AirtableConfig {
  const apiKey = process.env.AIRTABLE_PAT;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!apiKey) throw missing("AIRTABLE_PAT");
  if (!baseId) throw missing("AIRTABLE_BASE_ID");
  return { apiKey, baseId };
}

export type AirtableBase = ReturnType<typeof openBase>;

export function openBase(cfg: AirtableConfig) {
  const base = new Airtable({ apiKey: cfg.apiKey }).base(cfg.baseId);
  // Throttle every Airtable HTTP call at its single funnel so paging bursts
  // (cockpit scans, fleet sweeps) stay under the per-base rate limit instead of
  // tripping 429s. See throttle.ts.
  return applyThrottle(base as Parameters<typeof applyThrottle>[0], {
    minIntervalMs: MIN_REQUEST_INTERVAL_MS,
    now: () => Date.now(),
    delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }) as typeof base;
}
