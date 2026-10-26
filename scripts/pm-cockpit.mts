#!/usr/bin/env -S pnpm tsx
import { createClient } from "@libsql/client";
import { LibsqlDialect } from "@libsql/kysely-libsql";
import {
  Kysely,
  type KyselyPlugin,
  type PluginTransformQueryArgs,
  type PluginTransformResultArgs,
  type QueryResult,
  type RootOperationNode,
  type UnknownRow,
} from "kysely";
import type { Db, DbConfig } from "../src/db/client.js";
import { readDbConfig } from "../src/db/client.js";
import type { Database } from "../src/db/schema.js";
import { listSites, listAllReports } from "../src/db/fleet-state.js";
import {
  countUnreplayedDeadLettersBySlug,
  oldestUnreplayedDeadLetterBySlug,
} from "../src/db/deadletter.js";
import { listNewSubmissions, countAutoSpamSince } from "../src/db/submissions.js";
import type { NotifyBounceCounts } from "../src/db/submissions.js";
import { listFleetEvents } from "../src/db/fleet-events.js";
import { screenOutsSince } from "../src/db/screenouts.js";
import { readDigestState, readCockpitRollup } from "../src/db/digest-state.js";
import {
  buildCockpitModel,
  buildNeedsYouFeed,
  buildSiteAlarmContext,
  type NeedsYouItem,
} from "../src/dashboard/fleet-cockpit.js";
import { resolveDashboardBaseUrl } from "../src/dashboard/handler-helpers.js";
import { isDashboardVisible, siteSlug } from "../src/fleet/site-row.js";
import type { WebsiteRow } from "../src/fleet/site-row.js";
import type { ReportRow } from "../src/reports/report-row.js";
import type { SubmissionRow } from "../src/reports/submission-row.js";
import type { FleetEvent } from "../src/db/fleet-events.js";
import type { DigestSnapshot } from "../src/alerts/digest-state.js";
import type { AttentionItem } from "../src/alerts/attention.js";
import {
  deadLetterEscalatesAt,
  directVulnEscalatesAt,
  transitiveVulnEscalatesAt,
} from "../src/alerts/waiting.js";
import { levelOf, RENOVATE_ATTENTION_DAYS } from "../src/alerts/ladder.js";
import { loadCredentialsIntoEnv } from "../src/util/credentials.js";
import { isMain } from "./lib/cli.mjs";

const USAGE = "usage: pnpm tsx scripts/pm-cockpit.mts [--since <iso with Z or offset>]";
const REFUSAL = "pm-cockpit: read-only connection refused a";
const CONTROL_ID = "__pm_cockpit_update_control__";

export type Args = { since?: string };

export function parseArgs(argv: string[]): Args {
  const o: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--since") {
      const v = argv[++i];
      if (v === undefined || Number.isNaN(Date.parse(v)) || !/(Z|[+-]\d\d:?\d\d)$/.test(v))
        throw new Error("--since needs an ISO time with Z or an offset");
      o.since = v;
    } else throw new Error(`unknown argument: ${a}`);
  }
  return o;
}

export const readOnlyPlugin: KyselyPlugin = {
  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    if (args.node.kind !== "SelectQueryNode") throw new Error(`${REFUSAL} ${args.node.kind}`);
    return args.node;
  },
  transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    return Promise.resolve(args.result);
  },
};

export async function openReadOnlyDb(cfg: DbConfig): Promise<Db> {
  const client = createClient(
    cfg.authToken ? { url: cfg.url, authToken: cfg.authToken } : { url: cfg.url },
  );
  return new Kysely<Database>({
    dialect: new LibsqlDialect({ client }),
    plugins: [readOnlyPlugin],
  });
}

export async function assertReadOnly(db: Db): Promise<void> {
  try {
    await db.updateTable("sites").set({ name: CONTROL_ID }).where("id", "=", CONTROL_ID).execute();
  } catch (e) {
    if (e instanceof Error && e.message.startsWith(REFUSAL)) return;
    throw new Error(
      `UPDATE control failed for another reason, refusing to continue: ${String(e)}`,
      {
        cause: e,
      },
    );
  }
  throw new Error("UPDATE control passed: the connection can write, refusing to continue");
}

export type CockpitInputs = {
  websites: WebsiteRow[];
  reports: ReportRow[];
  prior: DigestSnapshot;
  baseUrl: string;
  newSubmissions: SubmissionRow[];
  spamTotals: {
    honeypot: number;
    tooFast: number;
    markedSpam: number;
    computedAt?: string;
  } | null;
  recentEvents: FleetEvent[];
  autoFilteredCount: number;
  notifyBounces: ReadonlyMap<string, NotifyBounceCounts>;
  deadLetters: ReadonlyMap<string, number>;
  /** OD 87: the oldest unreplayed row per slug, the clock of a known site's hold. */
  deadLetterOldest: ReadonlyMap<string, string>;
};

export async function loadCockpitInputs(db: Db, now: Date): Promise<CockpitInputs> {
  const websites = await listSites(db);
  const reports = await listAllReports(db);
  const prior = await readDigestState(db);
  const newSubmissions = await listNewSubmissions(db);
  const rollup = await readCockpitRollup(db);
  const spamTotals =
    rollup !== null ? { ...rollup.spamTotals, computedAt: rollup.computedAt } : null;
  const recentEvents = await listFleetEvents(db, {
    sinceIso: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    limit: 20,
  });
  const autoFilteredCount = await countAutoSpamSince(db, screenOutsSince(now, 7));
  const notifyBounces: ReadonlyMap<string, NotifyBounceCounts> = new Map(
    Object.entries(rollup?.notifyBounces ?? {}),
  );
  const deadLetters = await countUnreplayedDeadLettersBySlug(db);
  const deadLetterOldest = await oldestUnreplayedDeadLetterBySlug(db);
  return {
    websites,
    reports,
    prior,
    baseUrl: resolveDashboardBaseUrl(process.env.DASHBOARD_BASE_URL),
    newSubmissions,
    spamTotals,
    recentEvents,
    autoFilteredCount,
    notifyBounces,
    deadLetters,
    deadLetterOldest,
  };
}

export type DatedReason = { text: string; day: string | null; how: string | null };

export type PmEntry = {
  group: NeedsYouItem["group"];
  siteName: string;
  slug: string;
  url: string;
  reasons: DatedReason[];
  isNew: boolean;
  hasCritical: boolean;
};

const GROUP_RANK: Record<NeedsYouItem["group"], number> = {
  broken: 0,
  attention: 1,
  watch: 2,
  approval: 3,
};

export function comparePmEntries(a: PmEntry, b: PmEntry): number {
  if (GROUP_RANK[a.group] !== GROUP_RANK[b.group]) return GROUP_RANK[a.group] - GROUP_RANK[b.group];
  if (a.group === "broken" && a.hasCritical !== b.hasCritical) return a.hasCritical ? -1 : 1;
  return a.siteName.toLowerCase().localeCompare(b.siteName.toLowerCase());
}

export type PmCockpit = {
  now: string;
  since: string | null;
  sites: number;
  needsYou: PmEntry[];
  watch: PmEntry[];
  /** Sites with roster gaps (#672 step 2). Not an ask and not Watch: listed so
   *  the pass sees them, never counted in broken, watch or approval. */
  setup: Array<{ siteName: string; url: string; gaps: string[] }>;
  waitingKeys: string[];
};

function askedFrom(it: AttentionItem, prior: DigestSnapshot, today: string): DatedReason {
  // OD 87: a held dead letter became an ask when its hold ran out, whatever the
  // snapshot says. Its clock is the oldest row's received_at, not firstFlaggedAt.
  if (it.kind === "deadletter" && it.oldestReceivedAt !== undefined) {
    const at = deadLetterEscalatesAt(it.oldestReceivedAt);
    if (at !== null)
      return { text: it.title, day: at.toISOString().slice(0, 10), how: "escalated" };
  }
  const was = prior[it.key];
  if (was === undefined) return { text: it.title, day: today, how: "first flagged" };
  if (it.kind === "vuln" && it.autoFixExhausted === true)
    return was.exhausted === true
      ? { text: it.title, day: null, how: null }
      : { text: it.title, day: today, how: "auto-fix exhausted" };
  if (it.kind === "vuln") {
    const at =
      it.transitiveOnly === true
        ? transitiveVulnEscalatesAt(was.firstFlaggedAt)
        : directVulnEscalatesAt(was.firstFlaggedAt);
    if (at !== null)
      return { text: it.title, day: at.toISOString().slice(0, 10), how: "escalated" };
  }
  // P1-78b: a Renovate PR is Watch until its 7th day red, then Attention. Its NEW
  // morning is the day it rose, as a vuln's is the day its wait failed.
  if (it.kind === "renovate" && it.level === "attention") {
    const at = new Date(
      Date.parse(was.firstFlaggedAt.slice(0, 10)) + RENOVATE_ATTENTION_DAYS * 86_400_000,
    );
    if (Number.isFinite(at.getTime()))
      return { text: it.title, day: at.toISOString().slice(0, 10), how: "escalated" };
  }
  return { text: it.title, day: was.firstFlaggedAt, how: "first flagged" };
}

export function buildPmCockpit(inputs: CockpitInputs, now: Date, since?: string): PmCockpit {
  if (Object.keys(inputs.prior).length === 0)
    throw new Error(
      "the digest snapshot is empty, missing or unreadable (readDigestState cannot tell these apart): nothing could be marked waiting, so every just-wait item would read as an ask. If the fleet truly has no attention items, the digest wrote an empty snapshot and this refusal is the cost of not guessing",
    );
  const model = buildCockpitModel(
    inputs.websites,
    inputs.reports,
    inputs.prior,
    inputs.baseUrl,
    now,
    inputs.newSubmissions,
    inputs.spamTotals,
    inputs.recentEvents,
    inputs.autoFilteredCount,
    inputs.notifyBounces,
    inputs.deadLetters,
    inputs.deadLetterOldest,
  );
  const today = now.toISOString().slice(0, 10);
  const dated = new Map<string, DatedReason>();
  for (const card of model.cards) {
    const slug = siteSlug(card.site.name);
    for (const it of card.items) {
      const d = askedFrom(it, inputs.prior, today);
      const k = `${slug}\u0000${it.title}`;
      const was = dated.get(k);
      if (!was || (was.day ?? "") < (d.day ?? "")) dated.set(k, d);
    }
  }
  const sinceDay = since ? new Date(since).toISOString().slice(0, 10) : null;
  const isNew = (reasons: DatedReason[]): boolean =>
    sinceDay !== null && reasons.some((r) => r.day !== null && r.day >= sinceDay);
  const entries = buildNeedsYouFeed(model).map((f): PmEntry => {
    const reasons = f.reasons.map(
      (text) => dated.get(`${f.slug}\u0000${text}`) ?? { text, day: null, how: null },
    );
    return {
      group: f.group,
      siteName: f.siteName,
      slug: f.slug,
      url: f.url,
      reasons,
      isNew: isNew(reasons),
      hasCritical: f.hasCritical,
    };
  });

  // P1-78b: a failed deploy is a `deploy:` item on its card, so the feed above names
  // it, dated by the digest snapshot. The loop that added it here, undated, is gone.

  for (const it of model.cardless ?? []) {
    if (it.waiting === true) continue;
    const reason = askedFrom(it, inputs.prior, today);
    // A dead letter with a url resolved to a site with no card (archived, or an
    // unrecognized status): it has a page, and the site may already have a row
    // (Watch, or an approval), which it joins. Any
    // other cardless item, and a dead letter for a slug no site owns, has no page.
    const slug = it.kind === "deadletter" && it.url ? it.key.slice("deadletter:".length) : "";
    const e = slug ? entries.find((x) => x.slug === slug) : undefined;
    // P1-78b: a cardless item keeps its own level (an unknown-slug dead letter is
    // Broken, the fleet-wide url-probe-stale is Attention), and raises a row it joins.
    const level = it.level ?? levelOf(it, inputs.prior[it.key]?.firstFlaggedAt, now);
    if (e) {
      e.reasons.push(reason);
      if (GROUP_RANK[level] < GROUP_RANK[e.group]) e.group = level;
      e.isNew = isNew(e.reasons);
      e.hasCritical ||= it.severity === "critical";
    } else
      entries.push({
        group: level,
        siteName: it.siteName,
        slug,
        url: slug ? `/s/${slug}` : "(no site page)",
        reasons: [reason],
        isNew: isNew([reason]),
        hasCritical: it.severity === "critical",
      });
  }
  entries.sort(comparePmEntries);

  const waitingKeys: string[] = [];
  for (const site of inputs.websites.filter(isDashboardVisible)) {
    const ctx = buildSiteAlarmContext(
      site,
      inputs.reports.filter((r) => r.siteId === site.id),
      inputs.baseUrl,
      now,
      inputs.notifyBounces,
      inputs.deadLetters,
      inputs.prior,
      inputs.deadLetterOldest,
    );
    for (const it of ctx.items) if (it.waiting === true) waitingKeys.push(it.key);
  }
  // A held dead letter on a site with no card (archived) has no site page loop above.
  for (const it of model.cardless ?? []) if (it.waiting === true) waitingKeys.push(it.key);

  return {
    now: now.toISOString(),
    since: since ?? null,
    sites: model.cards.length,
    needsYou: entries.filter((e) => e.group !== "watch"),
    watch: entries.filter((e) => e.group === "watch"),
    setup: model.cards
      .filter((c) => (c.setup ?? []).length > 0)
      .map((c) => ({
        siteName: c.site.name,
        url: `/s/${siteSlug(c.site.name)}`,
        gaps: (c.setup ?? []).map((g) => g.reason),
      }))
      .sort((a, b) => a.siteName.toLowerCase().localeCompare(b.siteName.toLowerCase())),
    waitingKeys: waitingKeys.sort(),
  };
}

function reasonText(r: DatedReason): string {
  return r.day === null ? `${r.text} (undated)` : `${r.text} (${r.how} ${r.day})`;
}

export function formatPmCockpit(pm: PmCockpit): string {
  const all = [...pm.needsYou, ...pm.watch];
  const count = (g: NeedsYouItem["group"]): number => all.filter((e) => e.group === g).length;
  const sinceField =
    pm.since !== null ? ` new=${all.filter((e) => e.isNew).length} since=${pm.since}` : "";
  const out = [
    `PM_COCKPIT_SUMMARY broken=${count("broken")} attention=${count("attention")} watch=${count("watch")} approval=${count("approval")} setup=${pm.setup.length} sites=${pm.sites}${sinceField}`,
    `now=${pm.now} just_wait_left_out=${pm.waitingKeys.length}`,
    "",
    `## Needs you (${pm.needsYou.length})`,
  ];
  if (pm.needsYou.length === 0) out.push("(none)");
  for (const e of pm.needsYou) {
    out.push(`- ${e.isNew ? "NEW " : ""}${e.siteName} · ${e.group} · ${e.url}`);
    for (const r of e.reasons) out.push(`  - ${reasonText(r)}`);
  }
  out.push("", `## Watch (${pm.watch.length})`);
  if (pm.watch.length === 0) out.push("(none)");
  for (const e of pm.watch)
    out.push(
      `- ${e.isNew ? "NEW " : ""}${e.siteName} · ${e.url} · ${e.reasons.map(reasonText).join("; ")}`,
    );
  out.push("", `## Setup (${pm.setup.length})`);
  if (pm.setup.length === 0) out.push("(none)");
  for (const e of pm.setup) out.push(`- ${e.siteName} · ${e.url} · ${e.gaps.join("; ")}`);
  return out.join("\n") + "\n";
}

async function main(): Promise<void> {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`pm-cockpit: ${(e as Error).message}\n${USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  loadCredentialsIntoEnv();
  const db = await openReadOnlyDb(readDbConfig());
  try {
    await assertReadOnly(db);
    const now = new Date();
    const inputs = await loadCockpitInputs(db, now);
    process.stdout.write(formatPmCockpit(buildPmCockpit(inputs, now, args.since)));
  } finally {
    await db.destroy();
  }
}

if (isMain(import.meta.url)) {
  main().catch((e: unknown) => {
    process.stderr.write(`pm-cockpit: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  });
}
