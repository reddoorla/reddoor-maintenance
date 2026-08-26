/** Turso plan-quota headroom (#539 HIGH-10).
 *
 *  The starter plan carries `"overages": false`, which means crossing a quota
 *  BLOCKS reads and writes rather than billing for them. From the Airtable
 *  cutover on, Turso is the only store the fleet has — so a silently-approached
 *  quota is a fleet outage with no warning shot. This module turns the platform
 *  API's usage numbers into one machine line the nightly can gate on.
 *
 *  Quotas are read from the API's own /plans response rather than hardcoded:
 *  a plan upgrade must not leave the alarm measuring against a stale ceiling.
 */

/** Consumption that RESETS each billing cycle. A raw percentage of one of these
 *  is not comparable across the month — 30% on day 3 is a fire, 30% on day 28
 *  is fine — so these are projected to the cycle's end at the current rate. */
export const CUMULATIVE_METRICS = ["rows_read", "rows_written", "bytes_synced"] as const;

/** Consumption that is a LEVEL, not a per-cycle counter. Projecting storage
 *  linearly would invent growth the number does not describe. */
export const LEVEL_METRICS = ["storage_bytes"] as const;

/** Configuration ceilings, not consumption. Hitting one blocks CREATING another
 *  database/location/group; it does not degrade the database already running.
 *
 *  These are REPORTED but never alarm, at any level. Two reasons, both from
 *  reading the live numbers: the fleet sits at 2 of 3 locations by design, so a
 *  flat threshold would call a healthy fleet an emergency; and the starter plan
 *  allows exactly one group while the fleet runs exactly one, so a ceiling alarm
 *  would fire every single night about a standing, accepted plan constraint.
 *  A capacity ceiling also fails LOUDLY at creation time, where quota exhaustion
 *  silently blocks a live database — only the latter needs a warning shot. */
export const CAPACITY_METRICS = ["databases", "locations", "groups"] as const;

export type UsageMetric =
  | (typeof CUMULATIVE_METRICS)[number]
  | (typeof LEVEL_METRICS)[number]
  | (typeof CAPACITY_METRICS)[number];

/** usage-response key → /plans quota key. The two endpoints disagree on casing
 *  and on one name (`storage_bytes` vs `storage`), and a typo here would read as
 *  "unmeasured" forever, so a test asserts both directions of this map. */
export const QUOTA_KEY: Record<UsageMetric, string> = {
  rows_read: "rowsRead",
  rows_written: "rowsWritten",
  bytes_synced: "bytesSynced",
  storage_bytes: "storage",
  databases: "databases",
  locations: "locations",
  groups: "groups",
};

/** Below this much of a billing cycle, treat the cycle as this far along
 *  anyway. Without a floor the first reading after a cycle rolls over divides a
 *  real number by ~0 and projects nonsense; six hours is long enough to absorb
 *  one nightly batch and short enough to still catch a runaway inside a day. */
const ELAPSED_FLOOR_MS = 6 * 60 * 60 * 1000;

/** Fraction of a quota that counts as "approaching it". Deliberately far from
 *  the ceiling: the point is to leave room to act, and current usage is three
 *  orders of magnitude below this. */
export const DEFAULT_THRESHOLD_PCT = 50;

export type UsageInput = {
  plan: string;
  /** The plan's quota object, verbatim from GET /organizations/{org}/plans. */
  quotas: Partial<Record<string, number>>;
  /** The `total` usage object, verbatim from GET /organizations/{org}/usage. */
  usage: Partial<Record<string, number>>;
  cycleStart: Date;
  cycleEnd: Date;
  now: Date;
  blockedReads: boolean;
  blockedWrites: boolean;
  thresholdPct?: number;
};

export type UsageAssessment = {
  /** Human-readable table, one row per metric. */
  lines: string[];
  /** The single greppable line, emitted on every run including clean ones. */
  marker: string;
  code: number;
};

const pct = (used: number, quota: number): number => (quota > 0 ? (used / quota) * 100 : 0);
const fmt = (n: number): string => `${n.toFixed(2)}%`;

/** Turn one usage reading into a verdict. Pure: every input that varies —
 *  including `now` — is a parameter, so both the passing and the failing state
 *  are reachable from a test. */
export function assessUsage(input: UsageInput): UsageAssessment {
  const threshold = input.thresholdPct ?? DEFAULT_THRESHOLD_PCT;

  const cycleMs = Math.max(1, input.cycleEnd.getTime() - input.cycleStart.getTime());
  const rawElapsedMs = input.now.getTime() - input.cycleStart.getTime();
  const elapsedMs = Math.min(cycleMs, Math.max(ELAPSED_FLOOR_MS, rawElapsedMs));
  const elapsedFraction = elapsedMs / cycleMs;

  const fields: string[] = [];
  const rows: string[] = [];
  /** Metrics whose quota the plan publishes — the denominator of the check. */
  let measured = 0;
  const atCapacity: string[] = [];
  /** Every metric eligible to drive the verdict, with the number it is judged
   *  on — the projection for cumulative metrics, the raw level for storage.
   *  Capacity metrics never land here. */
  const candidates: Array<{ name: string; value: number }> = [];
  const consider = (name: string, value: number) => candidates.push({ name, value });

  const all: Array<{ metric: UsageMetric; kind: "cumulative" | "level" | "capacity" }> = [
    ...CUMULATIVE_METRICS.map((m) => ({ metric: m as UsageMetric, kind: "cumulative" as const })),
    ...LEVEL_METRICS.map((m) => ({ metric: m as UsageMetric, kind: "level" as const })),
    ...CAPACITY_METRICS.map((m) => ({ metric: m as UsageMetric, kind: "capacity" as const })),
  ];

  for (const { metric, kind } of all) {
    const quota = input.quotas[QUOTA_KEY[metric]];
    const used = input.usage[metric] ?? 0;

    // A metric with no published quota is UNMEASURED, not passing. The `pro`
    // plan really does omit `databases`, so this branch is live, not defensive.
    if (typeof quota !== "number" || !Number.isFinite(quota) || quota <= 0) {
      fields.push(`${metric}=unmeasured`);
      rows.push(`  ${metric.padEnd(14)} ${String(used).padStart(15)} / (no published quota)`);
      continue;
    }
    measured += 1;

    const now = pct(used, quota);
    fields.push(`${metric}=${fmt(now)}`);

    if (kind === "cumulative") {
      const projected = now / elapsedFraction;
      fields.push(`${metric}_proj=${fmt(projected)}`);
      consider(`${metric}_proj`, projected);
      rows.push(
        `  ${metric.padEnd(14)} ${String(used).padStart(15)} / ${String(quota).padEnd(13)} ${fmt(now).padStart(8)}  → ${fmt(projected)} by cycle end`,
      );
    } else if (kind === "level") {
      consider(metric, now);
      rows.push(
        `  ${metric.padEnd(14)} ${String(used).padStart(15)} / ${String(quota).padEnd(13)} ${fmt(now).padStart(8)}`,
      );
    } else {
      // Capacity: recorded for the marker line so the state is greppable, but
      // deliberately kept out of `worst` and out of the exit code.
      if (used >= quota) atCapacity.push(metric);
      rows.push(
        `  ${metric.padEnd(14)} ${String(used).padStart(15)} / ${String(quota).padEnd(13)} ${fmt(now).padStart(8)}  (ceiling)`,
      );
    }
  }

  const blocked = input.blockedReads ? "reads" : input.blockedWrites ? "writes" : "none";
  const worst = candidates.reduce<{ name: string; value: number } | null>(
    (acc, c) => (acc === null || c.value > acc.value ? c : acc),
    null,
  );
  const worstLabel = worst ? `${worst.name}:${fmt(worst.value)}` : "none";

  // Ordered by how bad the state actually is: already blocked beats a
  // projection, and a check that measured nothing beats both — a green
  // "nothing to report" from an instrument with no denominator is the exact
  // shape this repo keeps re-learning.
  let verdict: string;
  let code: number;
  if (measured === 0) {
    verdict = "unmeasurable";
    code = 1;
  } else if (blocked !== "none") {
    verdict = "blocked";
    code = 1;
  } else if (worst && worst.value >= threshold) {
    verdict = "over-threshold";
    code = 1;
  } else {
    verdict = "ok";
    code = 0;
  }

  const marker = [
    "FLEET_DB_USAGE",
    `plan=${input.plan}`,
    `elapsed=${fmt(elapsedFraction * 100)}`,
    ...fields,
    `measured=${measured}`,
    `worst=${worstLabel}`,
    `threshold=${fmt(threshold)}`,
    `blocked=${blocked}`,
    `at_capacity=${atCapacity.length ? atCapacity.join(",") : "none"}`,
    `verdict=${verdict}`,
  ].join(" ");

  return { lines: rows, marker, code };
}

/* ------------------------------------------------------------------ *
 * Transport
 * ------------------------------------------------------------------ */

const API = "https://api.turso.tech/v1";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type CollectDeps = {
  /** A PLATFORM API token (`turso auth api-tokens mint …`). This is NOT the
   *  database-level TURSO_AUTH_TOKEN the app runs on — that one cannot read
   *  quota state at all. */
  token: string;
  /** Org slug; discovered from the token when omitted. */
  org?: string | undefined;
  fetchImpl?: FetchLike | undefined;
  now: Date;
};

/** Read the platform API and assemble everything `assessUsage` needs.
 *  Deliberately throws on a bad response instead of returning zeros: a
 *  transport failure that reports 0% used would be an alarm that can never
 *  fire, which is the failure mode this whole module exists to avoid. */
export async function collectUsage(deps: CollectDeps): Promise<UsageInput> {
  const doFetch = deps.fetchImpl ?? (globalThis.fetch as FetchLike);
  const get = async (path: string): Promise<unknown> => {
    const url = `${API}${path}`;
    const res = await doFetch(url, {
      headers: { Authorization: `Bearer ${deps.token}` },
    });
    if (!res.ok) throw new Error(`Turso platform API ${res.status} for ${path}`);
    return res.json();
  };

  let org = deps.org;
  if (!org) {
    const orgs = (await get("/organizations")) as Array<{ slug?: string }>;
    org = orgs?.[0]?.slug;
    if (!org) throw new Error("Turso platform API returned no organizations for this token");
  }

  const [usageRes, plansRes, subRes, dbsRes] = await Promise.all([
    get(`/organizations/${org}/usage`) as Promise<{ total?: Record<string, number> }>,
    get(`/organizations/${org}/plans`) as Promise<{
      plans?: Array<{ name?: string; quotas?: Record<string, number> }>;
    }>,
    get(`/organizations/${org}/subscription`) as Promise<{
      subscription?: {
        plan?: string;
        current_billing_period_start?: string;
        current_billing_period_end?: string;
      };
    }>,
    get(`/organizations/${org}/databases`) as Promise<{
      databases?: Array<{ block_reads?: boolean; block_writes?: boolean }>;
    }>,
  ]);

  const sub = subRes.subscription ?? {};
  const plan = sub.plan ?? "unknown";
  // Match the quota block to the SUBSCRIBED plan. Taking plans[0] would keep
  // reporting starter percentages forever after an upgrade.
  const quotas = plansRes.plans?.find((p) => p.name === plan)?.quotas ?? {};

  const dbs = dbsRes.databases ?? [];

  return {
    plan,
    quotas,
    usage: usageRes.total ?? {},
    cycleStart: new Date(sub.current_billing_period_start ?? deps.now.toISOString()),
    cycleEnd: new Date(sub.current_billing_period_end ?? deps.now.toISOString()),
    now: deps.now,
    blockedReads: dbs.some((d) => d.block_reads === true),
    blockedWrites: dbs.some((d) => d.block_writes === true),
  };
}
